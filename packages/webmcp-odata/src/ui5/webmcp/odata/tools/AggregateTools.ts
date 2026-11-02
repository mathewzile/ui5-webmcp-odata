import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  AGGREGATION_METHODS,
  aggregationRules,
  buildApply,
} from "../metadata/ApplyBuilder";
import { objectSchema, type JsonSchema } from "../metadata/JsonSchema";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import { pick } from "../runtime/Keys";
import { failure, success } from "../runtime/Result";
import { guarded, type ToolSettings } from "./EntitySetTools";

type Input = Record<string, unknown>;

/**
 * `<Set>.aggregate`: group and aggregate with `$apply`. Only offered for sets whose service
 * announces `Aggregation.ApplySupported`; the names and methods come from that annotation.
 */
export function createAggregateTool(
  model: ODataModel,
  set: EntitySetDescriptor,
  settings: ToolSettings,
): WebMCP.ModelContextTool | undefined {
  const rules = aggregationRules(set);
  if (!rules || !set.readable) {
    return undefined;
  }
  const subject = set.label ?? set.name;
  const properties: Record<string, JsonSchema> = {
    groupBy: {
      type: "array",
      items: { type: "string", enum: rules.groupable },
      description: "Properties to group by; one result row per combination",
    },
    aggregate: {
      type: "array",
      description:
        "Aggregates per group, e.g. [{property:'stock',with:'sum',as:'total'}]" +
        (rules.customAggregates.length
          ? `. Custom aggregates (${rules.customAggregates.join(", ")}) take any 'with'`
          : ""),
      items: objectSchema(
        {
          property: {
            type: "string",
            enum: [
              ...rules.aggregatable.map((entry) => entry.property),
              ...rules.customAggregates,
            ],
          },
          with: { type: "string", enum: [...AGGREGATION_METHODS] },
          as: {
            type: "string",
            pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
            description: "Name of the result column",
          },
        },
        ["property", "with", "as"],
      ),
    },
    count: {
      type: "string",
      pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
      description: "Name of a result column with the number of entries per group",
    },
    filter: {
      type: "string",
      description: "OData $filter on the entries before they are grouped",
    },
    orderby: {
      type: "string",
      description: "Sort by result columns, e.g. 'total desc'. Default: the groupBy columns",
    },
    top: {
      type: "integer",
      minimum: 1,
      maximum: settings.maxTop,
      description: `Groups to return, default ${settings.maxTop}`,
    },
    skip: { type: "integer", minimum: 0, description: "Groups to skip" },
  };
  return {
    name: `${settings.toolPrefix}${set.name}.aggregate`,
    title: `Aggregate ${subject}`,
    description: `Groups ${subject} (${set.name}) entries and computes sums, averages, minimum, maximum or counts per group. Groupable: ${rules.groupable.join(", ")}. Aggregatable: ${rules.aggregatable.map((entry) => `${entry.property} (${entry.methods.join("/")})`).join(", ") || "none"}.${set.draft ? " Counts active data only." : ""}`,
    inputSchema: objectSchema(properties),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: guarded(async (input: Input) => {
      let built;
      try {
        built = buildApply(
          {
            groupBy: input.groupBy as string[] | undefined,
            aggregate: input.aggregate as never,
            count: input.count as string | undefined,
            filter: input.filter as string | undefined,
            orderby: input.orderby as string | undefined,
          },
          rules,
        );
      } catch (error) {
        return failure(error, "invalidAggregation");
      }
      const top = Math.min(
        (input.top as number | undefined) ?? settings.maxTop,
        settings.maxTop,
      );
      const skip = (input.skip as number | undefined) ?? 0;
      const list = model.bindList(
        `/${set.name}`,
        undefined,
        undefined,
        undefined,
        {
          $apply: built.apply,
          ...(built.orderby ? { $orderby: built.orderby } : {}),
          $count: true,
        },
      );
      try {
        const contexts = await list.requestContexts(skip, top);
        const count = list.getCount();
        // The service adds columns we did not ask for (the ETag property, IsActiveEntity)
        // and an ETag that belongs to no single entry, so only the requested columns are returned
        return success(
          contexts.map((context) => pick(context.getObject() as Input, built.columns)),
          {
            count,
            hasMore:
              count === undefined
                ? contexts.length === top
                : skip + contexts.length < count,
          },
        );
      } finally {
        list.destroy();
      }
    }),
  };
}
