import MessageToast from "sap/m/MessageToast";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { objectSchema, type JsonSchema } from "../metadata/JsonSchema";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import { invalidChanges } from "../metadata/Writable";
import {
  createItemSchema,
  deleteItemSchema,
  updateItemSchema,
} from "../metadata/WriteSchemas";
import type { EntityOperation } from "../Options";
import { throwIfAborted } from "../runtime/Abort";
import { refreshBindings, staleInfo } from "../runtime/BindingRefresher";
import { checkNoDraft } from "../runtime/DraftGuard";
import { etagOf } from "../runtime/Etag";
import { nextGroupId } from "../runtime/Groups";
import { clean, entityPath, pick, userKeyNames } from "../runtime/Keys";
import {
  openCreates,
  queueDelete,
  queueUpdate,
} from "../runtime/QueueWrite";
import { newQueue } from "../runtime/DeepApply";
import { errorFromMessages } from "../runtime/Reasons";
import { failure, newErrorMessages, success, type ToolResult } from "../runtime/Result";
import { confirm, guarded, type ToolSettings } from "./EntitySetTools";
import { text } from "../runtime/I18n";

type Input = Record<string, unknown>;

/**
 * `<Set>.batch`: creates, updates and deletes of one entity set in a single request. The
 * service applies all of them or none, so a rejected item leaves the data as it was.
 */
export function createBatchTool(
  model: ODataModel,
  set: EntitySetDescriptor,
  operations: EntityOperation[],
  settings: ToolSettings & { maxBatchItems: number },
  refreshSets: string[],
): WebMCP.ModelContextTool | undefined {
  const can = (operation: EntityOperation) => operations.includes(operation);
  if (!can("create") && !can("update") && !can("delete")) {
    return undefined;
  }
  const subject = set.label ?? set.name;
  const list = (schema: JsonSchema, description: string): JsonSchema => ({
    type: "array",
    items: schema,
    maxItems: settings.maxBatchItems,
    description,
  });
  const properties: Record<string, JsonSchema> = {
    ...(can("create") ? { create: list(createItemSchema(set), "Entries to create") } : {}),
    ...(can("update")
      ? { update: list(updateItemSchema(set), "Entries to change, each with its keys and 'changes'") }
      : {}),
    ...(can("delete") ? { delete: list(deleteItemSchema(set), "Entries to delete, by key") } : {}),
  };

  return {
    name: `${settings.toolPrefix}${set.name}.batch`,
    title: `Change several ${subject} entries`,
    description: `Creates, updates and deletes several ${subject} (${set.name}) entries in one request, at most ${settings.maxBatchItems} in total. All changes are applied together or none of them is.${set.draftRoot ? " Entries with an unsaved draft make the call fail." : ""}`,
    inputSchema: objectSchema(properties),
    annotations: { consequentialHint: true },
    execute: guarded(async (input: Input, signal) => {
      const creates = (can("create") ? input.create : undefined) as Input[] | undefined ?? [];
      const updates = (can("update") ? input.update : undefined) as Input[] | undefined ?? [];
      const deletes = (can("delete") ? input.delete : undefined) as Input[] | undefined ?? [];
      const total = creates.length + updates.length + deletes.length;
      if (!total) {
        return failure(new Error("Nothing to do: give create, update or delete entries"), "noChanges");
      }
      if (total > settings.maxBatchItems) {
        return failure(
          new Error(`${total} entries given, at most ${settings.maxBatchItems} are allowed in one call`),
          "tooManyItems",
        );
      }
      for (const [index, item] of updates.entries()) {
        const invalid = invalidChanges(set, (item.changes ?? {}) as Input);
        if (invalid) {
          return failure(new Error(`update[${index}]: ${invalid.message}`), invalid.reason);
        }
      }
      // A draft would overwrite the change when it is activated
      for (const [label, items] of [["update", updates], ["delete", deletes]] as const) {
        for (const [index, item] of items.entries()) {
          const blocked: ToolResult | undefined = await checkNoDraft(model, set, entityPath(set, item));
          if (blocked) {
            return { ...blocked, error: `${label}[${index}]: ${blocked.error}` };
          }
        }
      }

      const groupId = nextGroupId();
      const queue = newQueue();
      try {
        const created = [];
        if (creates.length) {
          const create = openCreates(model, set, groupId, queue);
          for (const item of creates) {
            created.push(create(item));
          }
        }
        const updated = [];
        for (const item of updates) {
          updated.push({ item, context: await queueUpdate(model, set, item, groupId, queue) });
        }
        for (const item of deletes) {
          await queueDelete(model, set, item, groupId, queue);
        }

        // One question for the whole batch; deletions are asked about even without confirmWrites
        const deleting = queue.deleted > 0 && settings.confirmDestructive;
        if (settings.confirmWrites || deleting) {
          const parts = [
            creates.length && text("batchCreate", creates.length),
            updates.length && text("batchUpdate", updates.length),
            queue.deleted && text("batchDelete", queue.deleted),
          ].filter(Boolean);
          if (!(await confirm(text("confirmBatch", subject, parts.join(", "))))) {
            model.resetChanges(groupId);
            return failure(new Error("The user declined the changes"), "declined");
          }
        }
        throwIfAborted(signal);
        await model.submitBatch(groupId);
        // A failed POST is inside a successful batch response; UI5 reports why only as messages
        if ((await Promise.all(queue.created)).includes(false)) {
          throw errorFromMessages(newErrorMessages());
        }
        const settled = await Promise.allSettled([...queue.pending, ...created.map((context) => context.created())]);
        const rejected = settled.find((entry) => entry.status === "rejected");
        if (rejected) {
          throw (rejected as PromiseRejectedResult).reason;
        }

        // Read the results before refreshing: the refresh drops the caches
        const keys = userKeyNames(set);
        const data = {
          created: created.map((context) => {
            const entity = context.getObject() as Input;
            return { ...clean(entity), etag: etagOf(entity) };
          }),
          updated: updated.map(({ item, context }) => ({
            key: pick(item, keys),
            etag: etagOf(context.getObject() as Input),
          })),
          deleted: deletes.map((item) => pick(item, keys)),
        };
        const stale = staleInfo(refreshBindings(model, refreshSets));
        MessageToast.show(text("toastBatchSaved", subject, total));
        return success(data, stale);
      } catch (error) {
        model.resetChanges(groupId);
        throw error;
      } finally {
        queue.bindings.forEach((binding) => binding.destroy());
      }
    }),
  };
}
