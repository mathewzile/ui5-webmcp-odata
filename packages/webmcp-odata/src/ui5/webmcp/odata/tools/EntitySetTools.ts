import MessageBox from "sap/m/MessageBox";
import MessageToast from "sap/m/MessageToast";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  objectSchema,
  propertySchema,
  type JsonSchema,
} from "../metadata/JsonSchema";
import type {
  CompositionDescriptor,
  EntitySetDescriptor,
} from "../metadata/ServiceIntrospector";
import type { EntityOperation, WebMCPOptions } from "../Options";
import { refreshBindings } from "../runtime/BindingRefresher";
import { checkNoDraft } from "../runtime/DraftGuard";
import {
  DRAFT_PROPERTIES,
  clean,
  entityPath,
  pick,
  userKeyNames,
} from "../runtime/Keys";
import { failure, serialize, success, type ToolResult } from "../runtime/Result";

interface ToolSettings {
  toolPrefix: string;
  maxTop: number;
  confirmDestructive: boolean;
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
  if (set.insertable) {
    allowed.push("create");
  }
  if (set.updatable) {
    allowed.push("update");
  }
  if (set.deletable) {
    allowed.push("delete");
  }
  const configured = options.entitySets?.[set.name]?.operations;
  return configured ? allowed.filter((op) => configured.includes(op)) : allowed;
}

/** Wraps a handler so that every outcome is a serialized ToolResult */
function guarded(
  handler: (input: Input) => Promise<ToolResult>,
): WebMCP.ToolExecuteCallback {
  return async (input) => {
    try {
      return serialize(await handler((input ?? {}) as Input));
    } catch (error) {
      return serialize(failure(error));
    }
  };
}

export function confirm(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    MessageBox.confirm(text, {
      title: "Confirm action requested by AI agent",
      onClose: (action: string | null) =>
        resolve(action === MessageBox.Action.OK),
    });
  });
}

function writableProperties(set: EntitySetDescriptor) {
  return set.properties.filter(
    (prop) => !prop.computed && !DRAFT_PROPERTIES.has(prop.name),
  );
}

/** Properties of a composition child the caller may set; the key to the parent is filled by the server */
function childProperties(composition: CompositionDescriptor) {
  return composition.properties.filter(
    (prop) =>
      !prop.computed &&
      !DRAFT_PROPERTIES.has(prop.name) &&
      !composition.foreignKeys.includes(prop.name),
  );
}

/** Schema entries to create children together with the parent (deep create) */
function compositionSchemas(
  set: EntitySetDescriptor,
): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const composition of set.compositions) {
    const properties = childProperties(composition);
    const item = objectSchema(
      Object.fromEntries(
        properties.map((prop) => [prop.name, propertySchema(prop)]),
      ),
      properties
        .filter((prop) => !prop.nullable && !prop.computedDefault)
        .map((prop) => prop.name),
    );
    const description = `${composition.name} (${composition.typeName.split(".").pop()}) created together with the parent in one request`;
    schemas[composition.name] = composition.isCollection
      ? { type: "array", items: item, description }
      : { ...item, description };
  }
  return schemas;
}

/** Keeps only allowed properties of the given children */
function childPayload(
  composition: CompositionDescriptor,
  value: unknown,
): Input | Input[] {
  const names = childProperties(composition).map((prop) => prop.name);
  const draft = composition.properties.some(
    (prop) => prop.name === "IsActiveEntity",
  );
  const one = (child: Input): Input => {
    const picked = pick(child, names);
    return draft ? { ...picked, IsActiveEntity: true } : picked;
  };
  return Array.isArray(value)
    ? value.map((child) => one(child as Input))
    : one(value as Input);
}

function keySchemas(set: EntitySetDescriptor): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const name of userKeyNames(set)) {
    const prop = set.properties.find((candidate) => candidate.name === name)!;
    schemas[name] = propertySchema(prop);
  }
  return schemas;
}

export function createEntitySetTools(
  model: ODataModel,
  set: EntitySetDescriptor,
  operations: EntityOperation[],
  settings: ToolSettings,
): WebMCP.ModelContextTool[] {
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
        description: "OData $orderby expression, e.g. 'title desc'",
      },
      expand: {
        type: "string",
        description: `OData $expand expression. Navigation: ${set.navigationProperties.map((nav) => nav.name).join(", ") || "none"}`,
      },
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
        const parameters: Record<string, unknown> = { $count: true };
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
        const top = Math.min(
          (input.top as number | undefined) ?? settings.maxTop,
          settings.maxTop,
        );
        const list = model.bindList(
          `/${set.name}`,
          undefined,
          undefined,
          undefined,
          parameters,
        );
        try {
          const contexts = await list.requestContexts(
            (input.skip as number | undefined) ?? 0,
            top,
          );
          return success(
            contexts.map((context) => clean(context.getObject())),
            {},
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
          expand: { type: "string", description: "OData $expand expression" },
        },
        userKeyNames(set),
      ),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guarded(async (input) => {
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
          return success(clean(await binding.requestObject()));
        } finally {
          binding.destroy();
        }
      }),
    });
  }

  if (operations.includes("create")) {
    const writable = writableProperties(set);
    tools.push({
      name: toolName("create"),
      title: `Create ${subject}`,
      description: `Creates a new ${subject} (${set.name}) entry. Computed properties such as generated IDs and administrative fields are set by the server.`,
      inputSchema: objectSchema(
        {
          ...Object.fromEntries(
            writable.map((prop) => [prop.name, propertySchema(prop)]),
          ),
          ...compositionSchemas(set),
        },
        // Generated keys (computedDefault) may be left out, the server fills them
        writable
          .filter((prop) => !prop.nullable && !prop.computedDefault)
          .map((prop) => prop.name),
      ),
      annotations: {},
      execute: guarded(async (input) => {
        const payload = pick(
          input,
          writable.map((prop) => prop.name),
        );
        for (const composition of set.compositions) {
          if (input[composition.name] !== undefined) {
            payload[composition.name] = childPayload(
              composition,
              input[composition.name],
            );
          }
        }
        if (set.draft) {
          // Create the active instance directly (draft bypass)
          payload.IsActiveEntity = true;
        }
        const list = model.bindList(`/${set.name}`);
        try {
          // The list is not shown anywhere, so there is nothing to refresh on it
          const context = list.create(payload, true);
          await context.created();
          const created = clean(context.getObject() as Input);
          refreshBindings(model, set.name);
          MessageToast.show(`${subject} created`);
          return success(created, { key: pick(created, userKeyNames(set)) });
        } finally {
          list.destroy();
        }
      }),
    });
  }

  if (operations.includes("update")) {
    const changeable = writableProperties(set).filter(
      (prop) => !prop.isKey && !prop.immutable,
    );
    tools.push({
      name: toolName("update"),
      title: `Update ${subject}`,
      description: `Changes properties of an existing ${subject} (${set.name}) entry. Only the properties in 'changes' are modified.${set.draftRoot ? " Fails if the entry has an unsaved draft." : ""}`,
      inputSchema: objectSchema(
        {
          ...keySchemas(set),
          changes: objectSchema(
            Object.fromEntries(
              changeable.map((prop) => [prop.name, propertySchema(prop)]),
            ),
          ),
        },
        [...userKeyNames(set), "changes"],
      ),
      annotations: {},
      execute: guarded(async (input) => {
        const path = entityPath(set, input);
        const changes = (input.changes ?? {}) as Input;
        const allowed = changeable.map((prop) => prop.name);
        const rejected = Object.keys(changes).filter(
          (name) => !allowed.includes(name),
        );
        if (rejected.length) {
          return failure(
            new Error(
              `Cannot change ${rejected.join(", ")}. Changeable: ${allowed.join(", ")}`,
            ),
            "notChangeable",
          );
        }
        if (!Object.keys(changes).length) {
          return failure(new Error("No changes given"), "noChanges");
        }
        const blocked = await checkNoDraft(model, set, path);
        if (blocked) {
          return blocked;
        }

        // Collect the changes in their own group, so they are sent as one atomic batch
        // Application group IDs may only consist of word characters
        const groupId = "webmcpUpdate";
        const binding = model.bindContext(path, undefined, {
          $$updateGroupId: groupId,
        });
        try {
          // The entity (and its ETag) must be loaded before properties can be set
          await binding.requestObject();
          const context = binding.getBoundContext();
          const pending = Object.entries(changes).map(([name, value]) =>
            context.setProperty(name, value),
          );
          await model.submitBatch(groupId);
          await Promise.all(pending);
          // Read before refreshing: the refresh also hits this very binding and drops its cache
          const updated = clean(context.getObject() as Input);
          refreshBindings(model, set.name);
          MessageToast.show(`${subject} updated`);
          return success(updated);
        } catch (error) {
          // Do not leave failed changes behind in the model
          model.resetChanges(groupId);
          throw error;
        } finally {
          binding.destroy();
        }
      }),
    });
  }

  if (operations.includes("delete")) {
    tools.push({
      name: toolName("delete"),
      title: `Delete ${subject}`,
      description: `Permanently deletes a ${subject} (${set.name}) entry by key.${set.draftRoot ? " Fails if the entry has an unsaved draft." : ""}${settings.confirmDestructive ? " The user is asked to confirm." : ""}`,
      inputSchema: objectSchema(keySchemas(set), userKeyNames(set)),
      annotations: { consequentialHint: true },
      execute: guarded(async (input) => {
        const path = entityPath(set, input);
        const blocked = await checkNoDraft(model, set, path);
        if (blocked) {
          return blocked;
        }
        if (
          settings.confirmDestructive &&
          !(await confirm(`Delete ${subject} ${path.slice(set.name.length + 1)}?`))
        ) {
          return failure(new Error("The user declined the deletion"), "declined");
        }
        const binding = model.bindContext(path);
        try {
          await binding.requestObject();
          await binding.getBoundContext().delete();
          refreshBindings(model, set.name);
          MessageToast.show(`${subject} deleted`);
          return success(undefined, { key: pick(input, userKeyNames(set)) });
        } finally {
          binding.destroy();
        }
      }),
    });
  }

  return tools;
}
