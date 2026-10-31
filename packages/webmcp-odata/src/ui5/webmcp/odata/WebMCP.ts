import Log from "sap/base/Log";
import type Component from "sap/ui/core/Component";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
// Side-effect type import: pulls in the global `document.modelContext` typings
import type {} from "webmcp-types";
import {
  introspect,
  type EntitySetDescriptor,
} from "./metadata/ServiceIntrospector";
import { DEFAULT_OPTIONS, type WebMCPOptions } from "./Options";
import { startCall } from "./runtime/Result";
import { createAppTools } from "./tools/AppTools";
import {
  allowedOperations,
  createEntitySetTools,
} from "./tools/EntitySetTools";
import { createOperationTool } from "./tools/OperationTools";

const LOG_COMPONENT = "ui5.webmcp.odata";

/**
 * Registers WebMCP tools derived from the metadata of an OData V4 model.
 *
 * @namespace ui5.webmcp.odata
 */
export default class ODataWebMCP {
  /**
   * Reads the metadata of the model and registers tools.
   *
   * @returns controller whose `abort()` unregisters all tools, or null if WebMCP is unavailable
   */
  public static async register(
    model: ODataModel | undefined,
    options: WebMCPOptions = {},
  ): Promise<AbortController | null> {
    const modelContext = document.modelContext;
    if (!modelContext?.registerTool || !model) {
      return null;
    }

    const settings = { ...DEFAULT_OPTIONS, ...options };
    const service = await introspect(model);
    const controller = new AbortController();

    const tools: WebMCP.ModelContextTool[] = [
      ...createAppTools(model, service, settings.toolPrefix),
    ];
    // Text tables of `localized` elements (CAP `Books_texts`) are an implementation detail; opt in via `include`
    const textTypes = new Set(
      service.entitySets.flatMap((set) =>
        set.navigationProperties
          .filter((nav) => nav.name === "texts")
          .map((nav) => nav.target),
      ),
    );
    const included = new Map<string, EntitySetDescriptor>();
    for (const set of service.entitySets) {
      if (
        (options.include && !options.include.includes(set.name)) ||
        options.exclude?.includes(set.name) ||
        (!options.include && textTypes.has(set.typeName))
      ) {
        continue;
      }
      included.set(set.name, set);
      tools.push(
        ...createEntitySetTools(
          model,
          set,
          allowedOperations(set, options),
          settings,
        ),
      );
    }
    for (const operation of service.operations) {
      const set = operation.entitySet
        ? included.get(operation.entitySet)
        : undefined;
      // Bound operations follow their entity set's inclusion and options
      if (
        operation.entitySet &&
        (!set || options.entitySets?.[set.name]?.skipOperations)
      ) {
        continue;
      }
      tools.push(
        createOperationTool(model, operation, set, settings.toolPrefix),
      );
    }
    for (const tool of tools) {
      const execute = tool.execute;
      tool.execute = (input, executeOptions) => {
        startCall();
        return execute(input, executeOptions);
      };
      try {
        await modelContext.registerTool(tool, {
          signal: controller.signal,
          exposedTo: settings.exposedTo,
        });
      } catch (error) {
        Log.error(`Cannot register tool ${tool.name}`, String(error), LOG_COMPONENT);
      }
    }
    Log.info(`Registered ${tools.length} WebMCP tools`, undefined, LOG_COMPONENT);
    return controller;
  }

  /**
   * Convenience for components: uses the default model and the `ui5.webmcp`
   * section of the `sap.ui5` manifest settings as options.
   */
  public static registerForComponent(
    component: Component,
    modelName?: string,
  ): Promise<AbortController | null> {
    const options = (component.getManifestEntry("/sap.ui5/ui5.webmcp") ??
      {}) as WebMCPOptions;
    return ODataWebMCP.register(
      component.getModel(modelName) as ODataModel | undefined,
      options,
    );
  }
}
