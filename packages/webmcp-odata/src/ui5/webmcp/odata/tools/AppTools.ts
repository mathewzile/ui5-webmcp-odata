import ElementRegistry from "sap/ui/core/ElementRegistry";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { objectSchema, propertySchema } from "../metadata/JsonSchema";
import type {
  EntitySetDescriptor,
  OperationDescriptor,
  ServiceDescriptor,
} from "../metadata/ServiceIntrospector";
import { refreshBindings } from "../runtime/BindingRefresher";
import { clean, entityPath, userKeyNames } from "../runtime/Keys";
import {
  currentMessages,
  failure,
  serialize,
  success,
} from "../runtime/Result";
import { confirm } from "./EntitySetTools";

function signature(op: OperationDescriptor): string {
  return `${op.kind} ${op.name}(${op.parameters.map((p) => p.name).join(", ")})`;
}

function describeSet(set: EntitySetDescriptor, operations: OperationDescriptor[]) {
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
    operations: operations
      .filter((op) => op.entitySet === set.name)
      .map(signature),
  };
}

/** Duck type for tables (mdc, sap.m) that expose their selection as contexts */
interface SelectableControl {
  getId(): string;
  getDomRef(): Element | null;
  getSelectedContexts(): { getObject(): unknown; getPath(): string }[];
  getRowBinding?(): { getPath(): string } | undefined;
  getBinding?(name: string): { getPath(): string } | undefined;
}

/**
 * Cross-cutting tools that are not tied to one entity set.
 */
export function createAppTools(
  model: ODataModel,
  service: ServiceDescriptor,
  prefix: string,
): WebMCP.ModelContextTool[] {
  return [
    {
      name: `${prefix}app.describe_service`,
      title: "Describe OData service",
      description:
        "Lists the entity sets of the OData service with keys, properties, allowed operations and relations. Call this first to learn what data is available.",
      inputSchema: objectSchema({
        entitySet: {
          type: "string",
          description: "Only describe this entity set (optional)",
        },
      }),
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const only = (input as { entitySet?: string }).entitySet;
        return serialize(
          success({
            entitySets: service.entitySets
              .filter((set) => !only || set.name === only)
              .map((set) => describeSet(set, service.operations)),
            unboundOperations: service.operations
              .filter((op) => !op.entitySet)
              .map(signature),
          }),
        );
      },
    },
    {
      name: `${prefix}app.refresh`,
      title: "Refresh data",
      description:
        "Reloads data shown in the app from the server, either for one entity set or everything. Use after changes made outside this app. Bindings with unsaved user edits are skipped.",
      inputSchema: objectSchema({
        entitySet: {
          type: "string",
          description: "Only refresh this entity set (optional)",
        },
      }),
      annotations: {},
      execute: (input) => {
        const refreshed = refreshBindings(
          model,
          (input as { entitySet?: string }).entitySet,
        );
        return serialize(success({ refreshed }));
      },
    },
    {
      name: `${prefix}app.get_messages`,
      title: "Get messages",
      description:
        "Returns the messages (errors, warnings, info) currently shown in the app, such as server validation errors.",
      annotations: { readOnlyHint: true },
      execute: () => serialize(success(currentMessages(true))),
    },
    {
      name: `${prefix}app.pending_changes`,
      title: "Check pending changes",
      description:
        "Tells whether the user has unsaved changes in the app. Check before changing data to avoid clobbering their edits.",
      annotations: { readOnlyHint: true },
      execute: () =>
        serialize(success({ hasPendingChanges: model.hasPendingChanges() })),
    },
    {
      name: `${prefix}app.reset_changes`,
      title: "Discard pending changes",
      description:
        "Discards the user's unsaved changes in the app. The user is asked to confirm.",
      annotations: { consequentialHint: true },
      execute: async () => {
        if (!model.hasPendingChanges()) {
          return serialize(success({ discarded: false }));
        }
        if (!(await confirm("Discard all unsaved changes?"))) {
          return serialize(
            failure(new Error("The user declined"), "declined"),
          );
        }
        try {
          await Promise.all([
            model.resetChanges("$auto"),
            model.resetChanges("$direct"),
          ]);
          return serialize(success({ discarded: true }));
        } catch (error) {
          return serialize(failure(error));
        }
      },
    },
    {
      name: `${prefix}app.get_current_context`,
      title: "Get current context",
      description:
        "Returns what the user currently sees: the page location (URL hash) and the rows they have selected in tables. Use for requests like 'update the selected items'.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => {
        const tables = ElementRegistry
          .filter(
            (element) =>
              typeof (element as unknown as Partial<SelectableControl>)
                .getSelectedContexts === "function" && !!element.getDomRef(),
          )
          .map((element) => {
            const table = element as unknown as SelectableControl;
            const binding =
              table.getRowBinding?.() ?? table.getBinding?.("items");
            return {
              id: table.getId(),
              binding: binding?.getPath(),
              selected: table
                .getSelectedContexts()
                .slice(0, 20)
                .map((context) => ({
                  path: context.getPath(),
                  data: clean(context.getObject()),
                })),
            };
          })
          // A table is typically a stack of controls (macro, mdc, inner table) with the same rows
          .filter(
            (table, index, all) =>
              all.findIndex(
                (other) =>
                  other.binding === table.binding &&
                  JSON.stringify(other.selected) ===
                    JSON.stringify(table.selected),
              ) === index,
          );
        return serialize(
          success({ hash: HashChanger.getInstance().getHash(), tables }),
        );
      },
    },
    {
      name: `${prefix}app.navigate`,
      title: "Navigate",
      description:
        "Opens an entity set's list page, or the page of a single entry when its key is given. Works with Fiori elements style routing (hash '<EntitySet>(<key>)').",
      inputSchema: objectSchema(
        {
          entitySet: {
            type: "string",
            enum: service.entitySets.map((set) => set.name),
          },
          ...Object.fromEntries(
            [...new Set(service.entitySets.flatMap(userKeyNames))].map((name) => {
              const prop = service.entitySets
                .flatMap((set) => set.properties)
                .find((candidate) => candidate.name === name)!;
              return [name, propertySchema(prop)];
            }),
          ),
        },
        ["entitySet"],
      ),
      annotations: {},
      execute: (input) => {
        const values = (input ?? {}) as Record<string, unknown>;
        const set = service.entitySets.find(
          (candidate) => candidate.name === values.entitySet,
        );
        if (!set) {
          return serialize(
            failure(new Error("Unknown entity set"), "unknownEntitySet"),
          );
        }
        try {
          const hasKey = userKeyNames(set).every(
            (name) => values[name] !== undefined,
          );
          // Without a key the list page is the root of the app
          HashChanger.getInstance().setHash(
            hasKey ? entityPath(set, values).slice(1) : "",
          );
          return serialize(success({ hash: HashChanger.getInstance().getHash() }));
        } catch (error) {
          return serialize(failure(error));
        }
      },
    },
  ];
}
