import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { objectSchema, type JsonSchema } from "../metadata/JsonSchema";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import {
  DRAFT_NAVIGATIONS,
  disallowedExpands,
  nonSortableIn,
} from "../metadata/QueryChecks";
import { invalidChanges } from "../metadata/Writable";
import {
  createItemSchema,
  etagSchema,
  keySchemas,
  updateItemSchema,
} from "../metadata/WriteSchemas";
import type { EntityOperation, WebMCPOptions } from "../Options";
import { throwIfAborted } from "../runtime/Abort";
import { refreshBindings, staleInfo } from "../runtime/BindingRefresher";
import { refreshSetNames } from "../runtime/DeepPayload";
import { checkNoDraft } from "../runtime/DraftGuard";
import { etagMismatch, etagOf } from "../runtime/Etag";
import { nextGroupId } from "../runtime/Groups";
import {
  clean,
  entityPath,
  pick,
  userKeyNames,
} from "../runtime/Keys";
import {
  openCreates,
  queueUpdate,
} from "../runtime/QueueWrite";
import { newQueue } from "../runtime/DeepApply";
import { errorFromMessages } from "../runtime/Reasons";
import {
  failure,
  newErrorMessages,
  serialize,
  success,
  type ToolResult,
} from "../runtime/Result";
import { text } from "../runtime/I18n";

export interface ToolSettings {
  toolPrefix: string;
  maxTop: number;
  confirmDestructive: boolean;
  /** Ask the user before create, update, move and batch (default false) */
  confirmWrites?: boolean;
  /** Ask the user before running actions: all of them, or the named ones (default false) */
  confirmActions?: boolean | string[];
}

type Input = Record<string, unknown>;

/** Operations the metadata allows, narrowed by the per-set option */
export function allowedOperations(
  set: EntitySetDescriptor,
  options: WebMCPOptions,
): EntityOperation[] {
  const allowed: EntityOperation[] = [];
  if (set.readable) {
    allowed.push("query", "get");
  }
  // A draft node (e.g. Chapters of a draft-enabled Book) can only be changed through its root:
  // the service answers 422 DRAFT_MODIFICATION_ONLY_VIA_ROOT for its own path. Its root's tools
  // reach it as a composition.
  if (set.insertable && !set.draftNode) {
    allowed.push("create");
  }
  if (set.updatable && !set.draftNode) {
    allowed.push("update");
  }
  if (set.deletable && !set.draftNode) {
    allowed.push("delete");
  }
  const configured = options.entitySets?.[set.name]?.operations;
  return configured ? allowed.filter((op) => configured.includes(op)) : allowed;
}

/** Wraps a handler so that every outcome is a serialized ToolResult */
export function guarded(
  handler: (input: Input, signal?: AbortSignal) => Promise<ToolResult>,
): WebMCP.ToolExecuteCallback {
  return async (input, options) => {
    try {
      throwIfAborted(options?.signal);
      return serialize(await handler((input ?? {}) as Input, options?.signal));
    } catch (error) {
      return serialize(failure(error));
    }
  };
}

export function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    MessageBox.confirm(question, {
      title: text("confirmTitle"),
      onClose: (action: string | null) =>
        resolve(action === MessageBox.Action.OK),
    });
  });
}

/** Whether the user, asked because of `confirmWrites`, declines the write */
export async function declinedWrite(
  settings: ToolSettings,
  question: string,
): Promise<boolean> {
  return !!settings.confirmWrites && !(await confirm(question));
}

/** Navigation properties `$expand` may follow: no draft administration, nothing the service forbids */
function expandableNavigations(set: EntitySetDescriptor): string[] {
  if (!set.expandable) {
    return [];
  }
  return set.navigationProperties
    .map((nav) => nav.name)
    .filter(
      (name) =>
        !DRAFT_NAVIGATIONS.includes(name) && !set.nonExpandable.includes(name),
    );
}

function staleEtagError(): Error {
  return new Error(
    "The entry was changed by someone else after you read it, nothing was saved. Read it again and retry.",
  );
}

function expandError(set: EntitySetDescriptor, rejected: string[]): Error {
  const allowed = expandableNavigations(set);
  return new Error(
    `Cannot expand ${rejected.join(", ")}. Navigation: ${allowed.join(", ") || "none"}`,
  );
}

export function createEntitySetTools(
  model: ODataModel,
  set: EntitySetDescriptor,
  operations: EntityOperation[],
  settings: ToolSettings,
  allSets: EntitySetDescriptor[] = [],
): WebMCP.ModelContextTool[] {
  // The sets whose bindings show data written through the compositions of this set
  const refreshSets = refreshSetNames(set, allSets);
  const toolName = (operation: string) =>
    `${settings.toolPrefix}${set.name}.${operation}`;
  const subject = set.label ?? set.name;
  const tools: WebMCP.ModelContextTool[] = [];

  if (operations.includes("query")) {
    const filterable = set.properties
      .filter((prop) => !set.nonFilterable.includes(prop.name))
      .map((prop) => prop.name);
    const properties: Record<string, JsonSchema> = {
      filter: {
        type: "string",
        description: `OData $filter expression, e.g. "contains(title,'x') and stock gt 5". Filterable: ${filterable.join(", ")}`,
      },
      select: {
        type: "string",
        description: "Comma separated property names to return",
      },
      orderby: {
        type: "string",
        description: `OData $orderby expression, e.g. 'title desc'.${set.nonSortable.length ? ` Not sortable: ${set.nonSortable.join(", ")}` : ""}`,
      },
      ...(set.expandable
        ? {
            expand: {
              type: "string",
              description: `OData $expand expression. Navigation: ${expandableNavigations(set).join(", ") || "none"}`,
            },
          }
        : {}),
      top: {
        type: "integer",
        minimum: 1,
        maximum: settings.maxTop,
        description: `Page size, default ${settings.maxTop}`,
      },
      skip: { type: "integer", minimum: 0, description: "Rows to skip" },
    };
    if (set.searchable) {
      properties.search = { type: "string", description: "Free text search" };
    }
    tools.push({
      name: toolName("query"),
      title: `Query ${subject}`,
      description: `Reads ${subject} (${set.name}) entries with optional filter, sorting and paging.${set.description ? ` ${set.description}` : ""}`,
      inputSchema: objectSchema(properties),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guarded(async (input) => {
        const rejectedSort = nonSortableIn(
          (input.orderby as string | undefined) ?? "",
          set.nonSortable,
        );
        if (rejectedSort.length) {
          return failure(
            new Error(
              `Cannot sort by ${rejectedSort.join(", ")}. The service does not allow sorting by: ${set.nonSortable.join(", ")}`,
            ),
            "notSortable",
          );
        }
        const rejectedExpand = disallowedExpands(
          (input.expand as string | undefined) ?? "",
          expandableNavigations(set),
        );
        if (rejectedExpand.length) {
          return failure(expandError(set, rejectedExpand), "notExpandable");
        }
        // Some services refuse $count; then the page size is all that tells if more follows
        const parameters: Record<string, unknown> = set.countable
          ? { $count: true }
          : {};
        // Draft-enabled sets: tools only ever see active data
        const filter = input.filter as string | undefined;
        if (set.draft) {
          parameters.$filter = filter
            ? `(${filter}) and IsActiveEntity eq true`
            : "IsActiveEntity eq true";
        } else if (filter) {
          parameters.$filter = filter;
        }
        for (const name of ["select", "orderby", "expand", "search"]) {
          if (input[name]) {
            parameters[`$${name}`] = input[name];
          }
        }
        // Without a sort order the pages of a query are not guaranteed to follow each other
        if (!parameters.$orderby && userKeyNames(set).length) {
          parameters.$orderby = userKeyNames(set).join(",");
        }
        const top = Math.min(
          (input.top as number | undefined) ?? settings.maxTop,
          settings.maxTop,
        );
        const skip = (input.skip as number | undefined) ?? 0;
        const list = model.bindList(
          `/${set.name}`,
          undefined,
          undefined,
          undefined,
          parameters,
        );
        try {
          const contexts = await list.requestContexts(skip, top);
          // Known once the request with $count has returned
          const count = list.getCount();
          return success(
            contexts.map((context) => clean(context.getObject())),
            {
              count,
              hasMore:
                count === undefined
                  ? contexts.length === top
                  : skip + contexts.length < count,
            },
          );
        } finally {
          list.destroy();
        }
      }),
    });
  }

  if (operations.includes("get")) {
    tools.push({
      name: toolName("get"),
      title: `Get ${subject}`,
      description: `Reads a single ${subject} (${set.name}) entry by key.`,
      inputSchema: objectSchema(
        {
          ...keySchemas(set),
          select: {
            type: "string",
            description: "Comma separated property names to return",
          },
          ...(set.expandable
            ? {
                expand: {
                  type: "string",
                  description: `OData $expand expression. Navigation: ${expandableNavigations(set).join(", ") || "none"}`,
                },
              }
            : {}),
        },
        userKeyNames(set),
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guarded(async (input) => {
        const rejectedExpand = disallowedExpands(
          (input.expand as string | undefined) ?? "",
          expandableNavigations(set),
        );
        if (rejectedExpand.length) {
          return failure(expandError(set, rejectedExpand), "notExpandable");
        }
        const parameters: Record<string, unknown> = {};
        if (input.select) {
          parameters.$select = input.select;
        }
        if (input.expand) {
          parameters.$expand = input.expand;
        }
        const binding = model.bindContext(
          entityPath(set, input),
          undefined,
          parameters,
        );
        try {
          const entity = await binding.requestObject();
          return success(clean(entity), { etag: etagOf(entity) });
        } finally {
          binding.destroy();
        }
      }),
    });
  }

  if (operations.includes("create")) {
    tools.push({
      name: toolName("create"),
      title: `Create ${subject}`,
      description: `Creates a new ${subject} (${set.name}) entry. Computed properties such as generated IDs and administrative fields are set by the server.`,
      inputSchema: createItemSchema(set),
      annotations: {},
      execute: guarded(async (input, signal) => {
        if (await declinedWrite(settings, text("confirmCreate", subject))) {
          return failure(new Error("The user declined the creation"), "declined");
        }
        // Own group, submitted explicitly: UI5 repeats a failed creation for ever and
        // `created()` stays pending, so without `submitBatch` a rejected create would hang the tool.
        const groupId = nextGroupId();
        const queue = newQueue();
        try {
          // No bSkipRefresh: UI5 advises against it for a deep create (many single row requests
          // if the POST response lacks nested data); without it only missing data is requested
          const context = openCreates(model, set, groupId, queue)(input);
          throwIfAborted(signal);
          await model.submitBatch(groupId);
          // A failed POST is inside a successful batch response; UI5 reports why only as messages
          if ((await Promise.all(queue.created)).includes(false)) {
            throw errorFromMessages(newErrorMessages());
          }
          await context.created();
          const entity = context.getObject() as Input;
          const created = clean(entity);
          const stale = staleInfo(refreshBindings(model, refreshSets));
          MessageToast.show(text("toastCreated", subject));
          return success(created, {
            key: pick(created, userKeyNames(set)),
            etag: etagOf(entity),
            ...stale,
          });
        } catch (error) {
          // Drops the transient context, so UI5 does not send the rejected entity again
          model.resetChanges(groupId);
          throw error;
        } finally {
          queue.bindings.forEach((binding) => binding.destroy());
        }
      }),
    });
  }

  if (operations.includes("update")) {
    tools.push({
      name: toolName("update"),
      title: `Update ${subject}`,
      description: `Changes properties of an existing ${subject} (${set.name}) entry. Only the properties in 'changes' are modified.${set.compositions.length ? " Lists of child entries replace the existing ones: children missing from a list are deleted." : ""}${set.draftRoot ? " Fails if the entry has an unsaved draft." : ""}`,
      inputSchema: updateItemSchema(set),
      annotations: {},
      execute: guarded(async (input, signal) => {
        const invalid = invalidChanges(set, (input.changes ?? {}) as Input);
        if (invalid) {
          return failure(new Error(invalid.message), invalid.reason);
        }
        const blocked = await checkNoDraft(model, set, entityPath(set, input));
        if (blocked) {
          return blocked;
        }
        if (await declinedWrite(settings, text("confirmUpdate", subject))) {
          return failure(new Error("The user declined the update"), "declined");
        }

        // Collect the changes in their own group, so they are sent as one atomic batch;
        // a group per call keeps concurrent updates from submitting or resetting each other
        const groupId = nextGroupId();
        const queue = newQueue();
        try {
          const context = await queueUpdate(model, set, input, groupId, queue);
          if (
            queue.deleted &&
            settings.confirmDestructive &&
            !(await confirm(
              text("confirmDeleteChildren", subject, queue.deleted),
            ))
          ) {
            model.resetChanges(groupId);
            return failure(new Error("The user declined the deletion of child entries"), "declined");
          }
          throwIfAborted(signal);
          await model.submitBatch(groupId);
          // A failed POST is inside a successful batch response; UI5 reports why only as messages
          if ((await Promise.all(queue.created)).includes(false)) {
            throw errorFromMessages(newErrorMessages());
          }
          const settled = await Promise.allSettled(queue.pending);
          const rejectedChange = settled.find((entry) => entry.status === "rejected");
          if (rejectedChange) {
            throw (rejectedChange as PromiseRejectedResult).reason;
          }
          // Read before refreshing: the refresh also hits this very binding and drops its cache
          const entity = context.getObject() as Input;
          const updated = clean(entity);
          const stale = staleInfo(refreshBindings(model, refreshSets));
          MessageToast.show(text("toastUpdated", subject));
          return success(updated, { etag: etagOf(entity), ...stale });
        } catch (error) {
          // Do not leave failed changes behind in the model
          model.resetChanges(groupId);
          throw error;
        } finally {
          queue.bindings.forEach((binding) => binding.destroy());
        }
      }),
    });
  }

  if (operations.includes("delete")) {
    tools.push({
      name: toolName("delete"),
      title: `Delete ${subject}`,
      description: `Permanently deletes a ${subject} (${set.name}) entry by key.${set.draftRoot ? " Fails if the entry has an unsaved draft." : ""}${settings.confirmDestructive ? " The user is asked to confirm." : ""}`,
      inputSchema: objectSchema(
        { ...keySchemas(set), ...etagSchema(set) },
        userKeyNames(set),
      ),
      annotations: { consequentialHint: true },
      execute: guarded(async (input, signal) => {
        const path = entityPath(set, input);
        const blocked = await checkNoDraft(model, set, path);
        if (blocked) {
          return blocked;
        }
        if (
          settings.confirmDestructive &&
          !(await confirm(text("confirmDelete", subject, path.slice(set.name.length + 1))))
        ) {
          return failure(new Error("The user declined the deletion"), "declined");
        }
        const binding = model.bindContext(path);
        try {
          const current = await binding.requestObject();
          if (etagMismatch(input.etag, current)) {
            return failure(staleEtagError(), "precondition");
          }
          throwIfAborted(signal);
          await binding.getBoundContext().delete();
          const stale = staleInfo(refreshBindings(model, refreshSets));
          MessageToast.show(text("toastDeleted", subject));
          return success(undefined, {
            key: pick(input, userKeyNames(set)),
            ...stale,
          });
        } finally {
          binding.destroy();
        }
      }),
    });
  }

  return tools;
}
