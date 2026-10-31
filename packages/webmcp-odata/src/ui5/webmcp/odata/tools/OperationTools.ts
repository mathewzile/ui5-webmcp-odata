import MessageToast from "sap/m/MessageToast";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  objectSchema,
  parameterSchema,
  propertySchema,
  type JsonSchema,
} from "../metadata/JsonSchema";
import type {
  EntitySetDescriptor,
  OperationDescriptor,
} from "../metadata/ServiceIntrospector";
import { refreshBindings } from "../runtime/BindingRefresher";
import { checkNoDraft } from "../runtime/DraftGuard";
import { clean, entityPath, userKeyNames } from "../runtime/Keys";
import { failure, serialize, success } from "../runtime/Result";

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
): WebMCP.ModelContextTool {
  const isFunction = operation.kind === "function";
  const keys = set ? userKeyNames(set) : [];
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
      `${isFunction ? "Calls" : "Runs"} the ${operation.kind} ${operation.name}${set ? ` on a single ${set.name} entry` : ""}.${
        operation.returnType ? ` Returns ${operation.returnsCollection ? "a list of " : ""}${operation.returnType}.` : ""
      }`,
    inputSchema: objectSchema(
      { ...keyProperties, ...parameterProperties },
      required,
    ),
    // Functions have no side effects by definition
    annotations: isFunction ? { readOnlyHint: true } : {},
    execute: async (rawInput) => {
      const input = (rawInput ?? {}) as Input;
      try {
        let entityBinding: ODataContextBinding | undefined;
        let binding: ODataContextBinding;
        if (set) {
          const entity = entityPath(set, input);
          if (!isFunction) {
            const blocked = await checkNoDraft(model, set, entity);
            if (blocked) {
              return serialize(blocked);
            }
          }
          // Bind relative to the loaded entity: only then UI5 knows its ETag and sends If-Match
          entityBinding = model.bindContext(entity);
          await entityBinding.requestObject();
          binding = model.bindContext(
            `${operation.qualifiedName}(...)`,
            entityBinding.getBoundContext(),
          );
        } else {
          binding = model.bindContext(`/${operation.name}(...)`);
        }
        try {
          for (const parameter of operation.parameters) {
            if (input[parameter.name] !== undefined) {
              binding.setParameter(parameter.name, input[parameter.name]);
            }
          }
          await binding.invoke();
          let value = binding.getBoundContext()?.getObject() as unknown;
          // Collection results arrive wrapped as { value: [...] }
          if (operation.returnsCollection && (value as Input)?.value) {
            value = (value as Input).value;
          }
          if (!isFunction) {
            refreshBindings(model, set?.name);
            MessageToast.show(`${subject} executed`);
          }
          return serialize(success(value === undefined ? undefined : clean(value)));
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
