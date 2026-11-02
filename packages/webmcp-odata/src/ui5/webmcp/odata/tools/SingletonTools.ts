import MessageToast from "sap/m/MessageToast";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { objectSchema, propertySchema } from "../metadata/JsonSchema";
import type { SingletonDescriptor } from "../metadata/ServiceIntrospector";
import { throwIfAborted } from "../runtime/Abort";
import { refreshBindings, staleInfo } from "../runtime/BindingRefresher";
import { etagOf } from "../runtime/Etag";
import { flattenChanges } from "../runtime/Flatten";
import { nextGroupId } from "../runtime/Groups";
import { clean } from "../runtime/Keys";
import { failure, success } from "../runtime/Result";
import { declinedWrite, guarded } from "./EntitySetTools";
import { text } from "../runtime/I18n";

type Input = Record<string, unknown>;

/**
 * Tools for a singleton: one instance in the service root, so no key is needed.
 * `get` reads it, `update` changes properties of it (only if the service allows updates).
 */
export function createSingletonTools(
  model: ODataModel,
  singleton: SingletonDescriptor,
  toolPrefix: string,
  confirmWrites = false,
): WebMCP.ModelContextTool[] {
  const subject = singleton.label ?? singleton.name;
  const path = `/${singleton.name}`;
  const name = (operation: string) => `${toolPrefix}${singleton.name}.${operation}`;
  const tools: WebMCP.ModelContextTool[] = [
    {
      name: name("get"),
      title: `Get ${subject}`,
      description: `Reads the singleton ${subject} (${singleton.name}).${singleton.description ? ` ${singleton.description}` : ""}`,
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guarded(async () => {
        const binding = model.bindContext(path);
        try {
          const entity = (await binding.requestObject()) as Input;
          return success(clean(entity), { etag: etagOf(entity) });
        } finally {
          binding.destroy();
        }
      }),
    },
  ];

  if (singleton.updatable) {
    const changeable = singleton.properties.filter(
      (prop) =>
        !prop.computed &&
        !prop.unsupported &&
        !prop.immutable &&
        !prop.isKey &&
        prop.fieldControl !== "readOnly" &&
        prop.fieldControl !== "inapplicable",
    );
    tools.push({
      name: name("update"),
      title: `Update ${subject}`,
      description: `Changes properties of the singleton ${subject} (${singleton.name}). Only the properties in 'changes' are modified.`,
      inputSchema: objectSchema(
        {
          changes: objectSchema(
            Object.fromEntries(
              changeable.map((prop) => [prop.name, propertySchema(prop)]),
            ),
          ),
        },
        ["changes"],
      ),
      annotations: {},
      execute: guarded(async (input, signal) => {
        const changes = (input.changes ?? {}) as Input;
        const allowed = changeable.map((prop) => prop.name);
        const rejected = Object.keys(changes).filter((key) => !allowed.includes(key));
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
        if (await declinedWrite({ toolPrefix, maxTop: 0, confirmDestructive: false, confirmWrites }, text("confirmUpdate", subject))) {
          return failure(new Error("The user declined the update"), "declined");
        }
        const groupId = nextGroupId();
        const binding = model.bindContext(path, undefined, {
          $$updateGroupId: groupId,
        });
        try {
          await binding.requestObject();
          const context = binding.getBoundContext();
          const pending = Object.entries(
            flattenChanges(
              changes,
              changeable
                .filter((prop) => prop.complexProperties)
                .map((prop) => prop.name),
            ),
          ).map(([key, value]) => context.setProperty(key, value));
          throwIfAborted(signal);
          await model.submitBatch(groupId);
          await Promise.all(pending);
          const entity = context.getObject() as Input;
          const updated = clean(entity);
          const stale = staleInfo(refreshBindings(model, singleton.name));
          MessageToast.show(text("toastUpdated", subject));
          return success(updated, { etag: etagOf(entity), ...stale });
        } catch (error) {
          model.resetChanges(groupId);
          throw error;
        } finally {
          binding.destroy();
        }
      }),
    });
  }
  return tools;
}
