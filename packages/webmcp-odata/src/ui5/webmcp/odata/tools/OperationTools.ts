import MessageToast from "sap/m/MessageToast";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  objectSchema,
  parameterSchema,
  propertySchema,
  type JsonSchema,
} from "../metadata/JsonSchema";
import { isAvailableFor, refreshTargets } from "../metadata/Availability";
import { pathToRoot } from "../metadata/DraftRoot";
import type {
  EntitySetDescriptor,
  OperationDescriptor,
} from "../metadata/ServiceIntrospector";
import { throwIfAborted } from "../runtime/Abort";
import { refreshBindings, staleInfo } from "../runtime/BindingRefresher";
import { checkNoDraft } from "../runtime/DraftGuard";
import { clean, entityPath, userKeyNames } from "../runtime/Keys";
import { failure, serialize, success } from "../runtime/Result";
import { actionNeedsConfirmation } from "../Options";
import { confirm } from "./EntitySetTools";
import { text } from "../runtime/I18n";

type Input = Record<string, unknown>;

/**
 * Builds a tool for an unbound action/function import or for an operation bound
 * to an entity. Actions on draft roots run against the active entity, and only
 * if it has no draft.
 */
export function createOperationTool(
  model: ODataModel,
  operation: OperationDescriptor,
  set: EntitySetDescriptor | undefined,
  toolPrefix: string,
  allSets: EntitySetDescriptor[] = [],
  confirmActions: boolean | string[] = false,
): WebMCP.ModelContextTool {
  const isFunction = operation.kind === "function";
  const needsConfirmation = !isFunction && actionNeedsConfirmation(operation.name, confirmActions);
  // Operations bound to the collection act on the set as a whole and take no key
  const onEntry = !!set && !operation.boundToCollection;
  const keys = set && onEntry ? userKeyNames(set) : [];
  const keyProperties: Record<string, JsonSchema> = {};
  for (const name of keys) {
    const prop = set!.properties.find((candidate) => candidate.name === name)!;
    keyProperties[name] = propertySchema(prop);
  }
  const parameterProperties: Record<string, JsonSchema> = {};
  for (const parameter of operation.parameters) {
    parameterProperties[parameter.name] = parameterSchema(parameter);
  }
  const required = [
    ...keys,
    ...operation.parameters
      .filter((parameter) => !parameter.nullable)
      .map((parameter) => parameter.name),
  ];

  const subject = operation.label ?? operation.name;
  return {
    name: `${toolPrefix}${set ? `${set.name}.` : ""}${operation.name}`,
    title: subject,
    description:
      operation.description ??
      `${isFunction ? "Calls" : "Runs"} the ${operation.kind} ${operation.name}${set ? (onEntry ? ` on a single ${set.name} entry` : ` on the ${set.name} collection`) : ""}.${
        operation.returnType ? ` Returns ${operation.returnsCollection ? "a list of " : ""}${operation.returnType}.` : ""
      }`,
    inputSchema: objectSchema(
      { ...keyProperties, ...parameterProperties },
      required,
    ),
    // Functions have no side effects by definition
    // Whatever an operation returns comes from the service and may carry injected text
    annotations: {
      ...(isFunction ? { readOnlyHint: true } : {}),
      ...(needsConfirmation ? { consequentialHint: true } : {}),
      ...(operation.returnType ? { untrustedContentHint: true } : {}),
    },
    execute: async (rawInput, options) => {
      const input = (rawInput ?? {}) as Input;
      try {
        throwIfAborted(options?.signal);
        let entityBinding: ODataContextBinding | undefined;
        let binding: ODataContextBinding;
        if (set && !onEntry) {
          // Bound to the collection: addressed through the set's path, no entry to load or guard
          binding = model.bindContext(`/${set.name}/${operation.qualifiedName}(...)`);
        } else if (set) {
          const entity = entityPath(set, input);
          if (!isFunction) {
            // On a draft node the draft that matters is the root's: guard through the back references
            const up = pathToRoot(set, allSets);
            const blocked = up
              ? await checkNoDraft(
                  model,
                  up.root,
                  [entity, ...up.navigations].join("/"),
                )
              : await checkNoDraft(model, set, entity);
            if (blocked) {
              return serialize(blocked);
            }
          }
          // Bind relative to the loaded entity: only then UI5 knows its ETag and sends If-Match
          entityBinding = model.bindContext(entity);
          const entry = (await entityBinding.requestObject()) as Input | undefined;
          // Core.OperationAvailable with a path: the entry says if the operation applies to it
          if (entry && !isAvailableFor(operation, entry)) {
            return serialize(
              failure(
                new Error(
                  `${subject} is not available for this entry (${(operation.available as { path: string }).path} is false)`,
                ),
                "notAvailable",
              ),
            );
          }
          binding = model.bindContext(
            `${operation.qualifiedName}(...)`,
            entityBinding.getBoundContext(),
          );
        } else {
          binding = model.bindContext(`/${operation.name}(...)`);
        }
        try {
          if (needsConfirmation && !(await confirm(set ? text("confirmRunOn", subject, set.name) : text("confirmRun", subject)))) {
            return serialize(failure(new Error(`The user declined to run ${subject}`), "declined"));
          }
          for (const parameter of operation.parameters) {
            if (input[parameter.name] !== undefined) {
              binding.setParameter(parameter.name, input[parameter.name]);
            }
          }
          throwIfAborted(options?.signal);
          await binding.invoke();
          let value = binding.getBoundContext()?.getObject() as unknown;
          // Collection results arrive wrapped as { value: [...] }
          if (operation.returnsCollection && (value as Input)?.value) {
            value = (value as Input).value;
          }
          let stale = {};
          if (!isFunction) {
            // Common.SideEffects narrows what is reloaded; without it everything is
            stale = staleInfo(
              refreshBindings(model, refreshTargets(operation, set, allSets)),
            );
            MessageToast.show(text("toastExecuted", subject));
          }
          return serialize(
            success(value === undefined ? undefined : clean(value), stale),
          );
        } finally {
          binding.destroy();
          entityBinding?.destroy();
        }
      } catch (error) {
        return serialize(failure(error));
      }
    },
  };
}
