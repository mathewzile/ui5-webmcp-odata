import { orderbyProperties } from "./QueryChecks";
import type { EntitySetDescriptor } from "./ServiceIntrospector";

export const AGGREGATION_METHODS = [
  "sum",
  "min",
  "max",
  "average",
  "countdistinct",
] as const;

const NUMERIC_TYPES = new Set([
  "Edm.Byte",
  "Edm.SByte",
  "Edm.Int16",
  "Edm.Int32",
  "Edm.Int64",
  "Edm.Decimal",
  "Edm.Double",
  "Edm.Single",
]);

const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface AggregateItem {
  property: string;
  /** Method; left out for a custom aggregate, which has its own */
  with?: string;
  as: string;
}

export interface AggregateInput {
  groupBy?: string[];
  aggregate?: AggregateItem[];
  /** Alias for the number of entries per group */
  count?: string;
  filter?: string;
  orderby?: string;
}

/** What the service accepts in `$apply` for one entity set, resolved against its properties */
export interface AggregationRules {
  groupable: string[];
  aggregatable: { property: string; methods: string[] }[];
  /** Aggregates the service computes itself; they take no method */
  customAggregates: string[];
  transformations: string[];
  /** Draft-enabled sets only count active data */
  draft: boolean;
}

/**
 * The names an agent may use, from `Aggregation.ApplySupported`. Lists the annotation leaves
 * out are open: any simple property may be grouped, any numeric one aggregated.
 */
export function aggregationRules(set: EntitySetDescriptor): AggregationRules | undefined {
  const support = set.aggregation;
  if (!support) {
    return undefined;
  }
  const simple = set.properties.filter(
    (prop) => !prop.unsupported && !prop.isCollection && !prop.complexProperties,
  );
  const draftColumns = ["IsActiveEntity", "HasActiveEntity", "HasDraftEntity"];
  return {
    groupable:
      support.groupable ??
      simple.map((prop) => prop.name).filter((name) => !draftColumns.includes(name)),
    aggregatable:
      support.aggregatable?.map((entry) => ({
        property: entry.property,
        methods: entry.methods?.length ? entry.methods : [...AGGREGATION_METHODS],
      })) ??
      simple
        .filter((prop) => NUMERIC_TYPES.has(prop.edmType))
        .map((prop) => ({ property: prop.name, methods: [...AGGREGATION_METHODS] })),
    customAggregates: support.customAggregates.map((aggregate) => aggregate.name),
    transformations: support.transformations,
    draft: set.draft,
  };
}

/** Parentheses outside of string literals must pair up, so a filter cannot add transformations */
function balanced(expression: string): boolean {
  let depth = 0;
  let quoted = false;
  for (const character of expression) {
    if (character === "'") {
      quoted = !quoted;
    } else if (!quoted && character === "(") {
      depth++;
    } else if (!quoted && character === ")" && --depth < 0) {
      return false;
    }
  }
  return depth === 0 && !quoted;
}

export interface BuiltApply {
  apply: string;
  /** Names of the columns of the result: grouped properties and aliases */
  columns: string[];
  orderby: string;
}

/**
 * Builds the `$apply` of an aggregate call, e.g.
 * `filter(IsActiveEntity eq true)/groupby((genre_ID),aggregate(stock with sum as total))`.
 * Everything the caller names is checked against the rules, nothing is passed through
 * except the `filter` expression, which has to be balanced.
 */
export function buildApply(input: AggregateInput, rules: AggregationRules): BuiltApply {
  const groupBy = input.groupBy ?? [];
  const aggregates = input.aggregate ?? [];
  const allows = (name: string) =>
    !rules.transformations.length || rules.transformations.includes(name);
  if (!groupBy.length && !aggregates.length && !input.count) {
    throw new Error("Give at least one of groupBy, aggregate or count");
  }
  if (groupBy.length && !allows("groupby")) {
    throw new Error("The service does not support groupby");
  }
  if ((aggregates.length || input.count) && !allows("aggregate")) {
    throw new Error("The service does not support aggregate");
  }
  if (input.filter && !allows("filter")) {
    throw new Error("The service does not support filter together with aggregation");
  }

  for (const name of groupBy) {
    if (!rules.groupable.includes(name)) {
      throw new Error(`Cannot group by ${name}. Groupable: ${rules.groupable.join(", ")}`);
    }
  }
  const columns = [...groupBy];
  const expressions: string[] = [];
  const addColumn = (alias: string) => {
    if (!ALIAS.test(alias)) {
      throw new Error(`Invalid alias ${alias}: use letters, digits and _`);
    }
    if (columns.includes(alias)) {
      throw new Error(`The name ${alias} is used twice`);
    }
    columns.push(alias);
  };

  for (const item of aggregates) {
    const custom = rules.customAggregates.includes(item.property);
    const entry = rules.aggregatable.find((candidate) => candidate.property === item.property);
    if (!custom && !entry) {
      throw new Error(
        `Cannot aggregate ${item.property}. Aggregatable: ${[
          ...rules.aggregatable.map((candidate) => candidate.property),
          ...rules.customAggregates,
        ].join(", ")}`,
      );
    }
    addColumn(item.as);
    // A custom aggregate has its method built in (CAP: `@Aggregation.default`). An explicit method is only
    // used if the property is also listed as aggregatable, so it never silently gets another method.
    if (custom && (!entry || !item.with)) {
      expressions.push(`${item.property} as ${item.as}`);
      continue;
    }
    if (!item.with) {
      throw new Error(`${item.property} needs a method (${entry!.methods.join(", ")})`);
    }
    if (!entry!.methods.includes(item.with)) {
      throw new Error(
        `Cannot use ${item.with} on ${item.property}. Methods: ${entry!.methods.join(", ")}`,
      );
    }
    expressions.push(`${item.property} with ${item.with} as ${item.as}`);
  }
  if (input.count) {
    addColumn(input.count);
    expressions.push(`$count as ${input.count}`);
  }

  if (input.filter && !balanced(input.filter)) {
    throw new Error("The filter has unbalanced parentheses");
  }
  const orderby = input.orderby?.trim() || groupBy.join(",");
  for (const name of orderby ? orderbyProperties(orderby) : []) {
    if (!columns.includes(name)) {
      throw new Error(`Cannot sort by ${name}. Result columns: ${columns.join(", ")}`);
    }
  }

  const steps: string[] = [];
  if (rules.draft) {
    steps.push("filter(IsActiveEntity eq true)");
  }
  if (input.filter) {
    steps.push(`filter(${input.filter})`);
  }
  const grouping = groupBy.length ? `(${groupBy.join(",")})` : "";
  const aggregation = expressions.length ? `aggregate(${expressions.join(",")})` : "";
  steps.push(
    groupBy.length
      ? `groupby(${grouping}${aggregation ? `,${aggregation}` : ""})`
      : aggregation,
  );
  return { apply: steps.join("/"), columns, orderby };
}
