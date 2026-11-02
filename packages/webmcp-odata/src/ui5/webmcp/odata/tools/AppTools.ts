import ElementRegistry from "sap/ui/core/ElementRegistry";
import HashChanger from "sap/ui/core/routing/HashChanger";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { objectSchema, propertySchema, type JsonSchema } from "../metadata/JsonSchema";
import type { ServiceDescriptor } from "../metadata/ServiceIntrospector";
import { objectPagePath } from "../metadata/ObjectPage";
import { describeService, type ConfirmationSettings } from "../metadata/ServiceDescription";
import { refreshBindings } from "../runtime/BindingRefresher";
import { clean, entityPath, userKeyNames } from "../runtime/Keys";
import {
  currentMessages,
  failure,
  serialize,
  success,
} from "../runtime/Result";
import { confirm } from "./EntitySetTools";
import { text } from "../runtime/I18n";

/** Duck type for tables (mdc, sap.m) that expose their selection as contexts */
interface SelectableControl {
  getId(): string;
  getDomRef(): Element | null;
  getSelectedContexts(): { getObject(): unknown; getPath(): string }[];
  getRowBinding?(): { getPath(): string } | undefined;
  getBinding?(name: string): { getPath(): string } | undefined;
}

/**
 * The entry of the object page the user has open, from the URL hash (`Books(ID=...,IsActiveEntity=true)`).
 * It may be the user's draft: `draft: true` then, and nothing the tools write reaches it.
 */
async function currentEntity(
  model: ODataModel,
  service: ServiceDescriptor,
  hash: string,
): Promise<{ entitySet: string; path: string; draft: boolean; data: unknown } | undefined> {
  const path = objectPagePath(hash, service.entitySets.map((set) => set.name));
  if (!path) {
    return undefined;
  }
  const binding = model.bindContext(path.path);
  try {
    const data = await binding.requestObject();
    return data === undefined
      ? undefined
      : {
          entitySet: path.entitySet,
          path: path.path,
          draft: /IsActiveEntity=false/.test(path.path),
          data: clean(data),
        };
  } catch {
    // The page may be a create page or no longer exist; the hash alone is still returned
    return undefined;
  } finally {
    binding.destroy();
  }
}

/**
 * Cross-cutting tools that are not tied to one entity set.
 */
export function createAppTools(
  model: ODataModel,
  service: ServiceDescriptor,
  prefix: string,
  /** Input schemas of the per-set tools, if they are only reachable through the generic tools */
  schemas?: Record<string, Record<string, JsonSchema>>,
  confirmation?: ConfirmationSettings,
): WebMCP.ModelContextTool[] {
  return [
    {
      name: `${prefix}app.describe_service`,
      title: "Describe OData service",
      description:
        "Lists the entity sets of the OData service with keys, properties, allowed operations and relations. Call this first to learn what data is available." +
        (schemas
          ? " With 'entitySet' it also returns 'tools': the input schema of each entity.* tool for that set, which you pass as 'arguments'."
          : ""),
      inputSchema: objectSchema({
        entitySet: {
          type: "string",
          description: "Only describe this entity set (optional)",
        },
      }),
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const only = (input as { entitySet?: string }).entitySet;
        const description = describeService(service, confirmation, only);
        return serialize(
          success({
            ...description,
            entitySets: description.entitySets.map((set) => ({
              ...set,
              ...(only && schemas ? { tools: schemas[set.name] } : {}),
            })),
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
        const { refreshed, skipped } = refreshBindings(
          model,
          (input as { entitySet?: string }).entitySet,
        );
        return serialize(
          success({ refreshed, skippedBecauseOfUnsavedChanges: skipped }),
        );
      },
    },
    {
      name: `${prefix}app.get_messages`,
      title: "Get messages",
      description:
        "Returns the messages (errors, warnings, info) currently shown in the app, such as server validation errors.",
      // Message texts come from the service
      annotations: { readOnlyHint: true, untrustedContentHint: true },
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
        if (!(await confirm(text("confirmDiscard")))) {
          return serialize(
            failure(new Error("The user declined"), "declined"),
          );
        }
        try {
          // The model's own update group ($auto by default); `$direct` is not allowed here.
          // Changes in other groups (Fiori elements uses its own) are reset on their bindings.
          model.resetChanges();
          const pending = model
            .getAllBindings()
            .filter(
              (binding) =>
                binding.isA([
                  "sap.ui.model.odata.v4.ODataListBinding",
                  "sap.ui.model.odata.v4.ODataContextBinding",
                ]) &&
                (binding as ODataListBinding | ODataContextBinding).hasPendingChanges(),
            ) as (ODataListBinding | ODataContextBinding)[];
          await Promise.all(pending.map((binding) => binding.resetChanges()));
          return serialize(
            success({ discarded: true, stillPending: model.hasPendingChanges() }),
          );
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
      execute: async () => {
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
        const hash = HashChanger.getInstance().getHash();
        return serialize(
          success({ hash, currentEntity: await currentEntity(model, service, hash), tables }),
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
