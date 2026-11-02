import Log from "sap/base/Log";
import type Component from "sap/ui/core/Component";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
// Side-effect type import: pulls in the global `document.modelContext` typings
import type {} from "webmcp-types";
import {
  introspect,
  type EntitySetDescriptor,
  type ServiceDescriptor,
} from "./metadata/ServiceIntrospector";
import { assignToolNames } from "./metadata/ToolNames";
import {
  DEFAULT_OPTIONS,
  operationAllowed,
  unknownEntitySets,
  type WebMCPOptions,
} from "./Options";
import { loadTexts } from "./runtime/I18n";
import { configureResults, startCall } from "./runtime/Result";
import { refreshSetNames } from "./runtime/DeepPayload";
import { createAggregateTool } from "./tools/AggregateTools";
import { createBatchTool } from "./tools/BatchTools";
import { createAppTools } from "./tools/AppTools";
import {
  allowedOperations,
  createEntitySetTools,
} from "./tools/EntitySetTools";
import { createGenericTools, toolSchemas, type SetTool } from "./tools/GenericTools";
import { createHierarchyTools } from "./tools/HierarchyTools";
import { createOperationTool } from "./tools/OperationTools";
import { createSingletonTools } from "./tools/SingletonTools";

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
    configureResults({ maxResultChars: settings.maxResultChars });
    await loadTexts();
    let service: ServiceDescriptor;
    try {
      service = await introspect(model, settings.maxCompositionDepth);
    } catch (error) {
      // A broken $metadata must not take the app down with an unhandled rejection
      Log.error("Cannot read the service metadata", String(error), LOG_COMPONENT);
      return null;
    }
    const controller = new AbortController();
    const unknown = unknownEntitySets(
      options,
      service.entitySets.map((set) => set.name),
    );
    if (unknown.length) {
      Log.warning(
        `Options mention entity sets the service does not have: ${unknown.join(", ")}`,
        undefined,
        LOG_COMPONENT,
      );
    }

    const tools: WebMCP.ModelContextTool[] = [];
    // Tools of one entity set and operation; registered as they are or behind the generic tools
    const setTools: SetTool[] = [];
    const addSetTool = (set: EntitySetDescriptor, tool: WebMCP.ModelContextTool) =>
      setTools.push({
        entitySet: set.name,
        operation: tool.name.slice(`${settings.toolPrefix}${set.name}.`.length),
        tool,
      });
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
      const aggregate = createAggregateTool(model, set, settings);
      const allowed = allowedOperations(set, options);
      if (aggregate && allowed.includes("query")) {
        addSetTool(set, aggregate);
      }
      const batch = createBatchTool(
        model,
        set,
        allowed,
        settings,
        refreshSetNames(set, service.entitySets),
      );
      if (batch) {
        addSetTool(set, batch);
      }
      if (allowed.includes("query")) {
        for (const tool of createHierarchyTools(model, set, settings, allowed.includes("update"))) {
          addSetTool(set, tool);
        }
      }
      for (const tool of createEntitySetTools(model, set, allowed, settings, service.entitySets)) {
        addSetTool(set, tool);
      }
    }
    // Many entity sets: one tool per operation instead of one per set and operation
    const generic =
      settings.toolMode === "generic" ||
      (settings.genericThreshold !== undefined && included.size > settings.genericThreshold);
    tools.unshift(
      ...createAppTools(
        model,
        service,
        settings.toolPrefix,
        generic ? toolSchemas(setTools) : undefined,
        {
          confirmWrites: settings.confirmWrites,
          confirmDestructive: settings.confirmDestructive,
          confirmActions: settings.confirmActions,
        },
      ),
      ...(generic
        ? createGenericTools(setTools, settings.toolPrefix)
        : setTools.map((entry) => entry.tool)),
    );
    for (const singleton of service.singletons) {
      if (
        (options.include && !options.include.includes(singleton.name)) ||
        options.exclude?.includes(singleton.name)
      ) {
        continue;
      }
      tools.push(...createSingletonTools(model, singleton, settings.toolPrefix, settings.confirmWrites));
    }
    for (const operation of service.operations) {
      // Core.OperationAvailable=false: the service never offers it; the option can narrow further
      if (
        operation.available === false ||
        !operationAllowed(operation.name, options.operations)
      ) {
        continue;
      }
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
        createOperationTool(
          model,
          operation,
          set,
          settings.toolPrefix,
          service.entitySets,
          settings.confirmActions,
        ),
      );
    }
    const { tools: named, problems } = assignToolNames(tools);
    for (const problem of problems) {
      Log.warning(
        `Tool name "${problem.requested}" is registered as "${problem.assigned}" (${problem.reason})`,
        undefined,
        LOG_COMPONENT,
      );
    }
    for (const tool of named) {
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
    Log.info(`Registered ${named.length} WebMCP tools`, undefined, LOG_COMPONENT);
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
