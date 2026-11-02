import { actionNeedsConfirmation } from "../Options";
import type {
  EntitySetDescriptor,
  OperationDescriptor,
  ServiceDescriptor,
  SingletonDescriptor,
} from "./ServiceIntrospector";

/** Which tools ask the user first, as configured by the options */
export interface ConfirmationSettings {
  confirmWrites: boolean;
  confirmDestructive: boolean;
  confirmActions: boolean | string[];
}

/** `action addStock(quantity)`, with a marker if the user is asked before it runs */
export function signature(
  operation: OperationDescriptor,
  confirmation?: ConfirmationSettings,
): string {
  const asks = actionNeedsConfirmation(operation.name, confirmation?.confirmActions);
  return `${operation.kind} ${operation.name}(${operation.parameters.map((p) => p.name).join(", ")})${
    operation.boundToCollection ? " on the whole collection" : ""
  }${asks ? " [asks the user]" : ""}`;
}

/** What a set offers beyond reading and writing single entries, and what asks the user first */
export function describeSet(
  set: EntitySetDescriptor,
  operations: OperationDescriptor[],
  confirmation?: ConfirmationSettings,
) {
  const asks = [
    confirmation?.confirmWrites && ["create", "update", "batch", "move"],
    confirmation?.confirmDestructive && ["delete"],
  ]
    .flat()
    .filter((name): name is string => typeof name === "string");
  return {
    name: set.name,
    label: set.label,
    description: set.description,
    keys: set.keys,
    allowed: {
      read: set.readable,
      insert: set.insertable,
      update: set.updatable,
      delete: set.deletable,
      search: set.searchable,
    },
    draftEnabled: set.draft,
    // A node of a draft tree is only changed through its root (deep update)
    ...(set.draftNode ? { draftNode: true } : {}),
    // `name:type`, flags: k key, c computed, g generated if omitted, i immutable, r required
    properties: set.properties.map((prop) => {
      const flags = [
        prop.isKey ? "k" : "",
        prop.computed ? "c" : "",
        prop.computedDefault ? "g" : "",
        prop.immutable ? "i" : "",
        !prop.nullable ? "r" : "",
      ].join("");
      return `${prop.name}:${prop.edmType.replace("Edm.", "")}${flags ? ` [${flags}]` : ""}`;
    }),
    navigation: set.navigationProperties
      .filter(
        (nav) =>
          nav.name !== "DraftAdministrativeData" && nav.name !== "SiblingEntity",
      )
      .map((nav) => `${nav.name} -> ${nav.target}${nav.isCollection ? "[]" : ""}`),
    // Children that create and update take as nested data
    ...(set.compositions.length
      ? { compositions: set.compositions.map((composition) => composition.name) }
      : {}),
    // The aggregate tool exists for these sets; only what is listed here can be grouped and aggregated
    ...(set.aggregation
      ? {
          aggregation: {
            groupable: set.aggregation.groupable ?? "any property",
            aggregatable: set.aggregation.aggregatable
              ? set.aggregation.aggregatable.map(
                  (entry) => `${entry.property}: ${(entry.methods ?? ["any method"]).join(", ")}`,
                )
              : "any property",
            customAggregates: set.aggregation.customAggregates.map((entry) => entry.name),
          },
        }
      : {}),
    // The hierarchy and move tools exist for these sets
    ...(set.hierarchies.length
      ? {
          hierarchies: set.hierarchies.map((hierarchy) => ({
            qualifier: hierarchy.qualifier,
            nodeProperty: hierarchy.nodeProperty,
            parent: hierarchy.parentKey ?? hierarchy.parentNavigation,
          })),
        }
      : {}),
    ...(asks.length ? { asksUserBefore: asks } : {}),
    operations: operations
      .filter((op) => op.entitySet === set.name)
      .map((op) => signature(op, confirmation)),
  };
}

export function describeSingleton(singleton: SingletonDescriptor) {
  return {
    name: singleton.name,
    label: singleton.label,
    description: singleton.description,
    updatable: singleton.updatable,
    properties: singleton.properties.map(
      (prop) => `${prop.name}:${prop.edmType.replace("Edm.", "")}${prop.nullable ? "" : " [r]"}`,
    ),
  };
}

/** Everything `app.describe_service` returns, except the per-set tool schemas of the generic mode */
export function describeService(
  service: ServiceDescriptor,
  confirmation?: ConfirmationSettings,
  only?: string,
) {
  return {
    entitySets: service.entitySets
      .filter((set) => !only || set.name === only)
      .map((set) => describeSet(set, service.operations, confirmation)),
    singletons: service.singletons
      .filter((singleton) => !only || singleton.name === only)
      .map(describeSingleton),
    unboundOperations: service.operations
      .filter((op) => !op.entitySet)
      .map((op) => signature(op, confirmation)),
  };
}
