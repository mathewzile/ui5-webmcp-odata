/**
 * Helpers to read vocabulary annotations from the raw `$metadata` JSON that
 * `ODataMetaModel#requestObject("/")` returns. UI5 resolves vocabulary aliases,
 * so terms are keyed by their full namespace.
 */
export const TERM = {
  computed: "@Org.OData.Core.V1.Computed",
  computedDefault: "@Org.OData.Core.V1.ComputedDefaultValue",
  immutable: "@Org.OData.Core.V1.Immutable",
  description: "@Org.OData.Core.V1.Description",
  concurrency: "@Org.OData.Core.V1.OptimisticConcurrency",
  insert: "@Org.OData.Capabilities.V1.InsertRestrictions",
  update: "@Org.OData.Capabilities.V1.UpdateRestrictions",
  delete: "@Org.OData.Capabilities.V1.DeleteRestrictions",
  read: "@Org.OData.Capabilities.V1.ReadRestrictions",
  search: "@Org.OData.Capabilities.V1.SearchRestrictions",
  filter: "@Org.OData.Capabilities.V1.FilterRestrictions",
  sort: "@Org.OData.Capabilities.V1.SortRestrictions",
  label: "@com.sap.vocabularies.Common.v1.Label",
  text: "@com.sap.vocabularies.Common.v1.Text",
  valueList: "@com.sap.vocabularies.Common.v1.ValueList",
  draftRoot: "@com.sap.vocabularies.Common.v1.DraftRoot",
  draftNode: "@com.sap.vocabularies.Common.v1.DraftNode",
  fieldControl: "@com.sap.vocabularies.Common.v1.FieldControl",
  valueListFixed: "@com.sap.vocabularies.Common.v1.ValueListWithFixedValues",
  minimum: "@Org.OData.Validation.V1.Minimum",
  maximum: "@Org.OData.Validation.V1.Maximum",
  allowedValues: "@Org.OData.Validation.V1.AllowedValues",
  expand: "@Org.OData.Capabilities.V1.ExpandRestrictions",
  count: "@Org.OData.Capabilities.V1.CountRestrictions",
  topSupported: "@Org.OData.Capabilities.V1.TopSupported",
  operationAvailable: "@Org.OData.Core.V1.OperationAvailable",
  applySupported: "@Org.OData.Aggregation.V1.ApplySupported",
  customAggregate: "@Org.OData.Aggregation.V1.CustomAggregate#",
  recursiveHierarchy: "@Org.OData.Aggregation.V1.RecursiveHierarchy#",
  hierarchyColumns: "@com.sap.vocabularies.Hierarchy.v1.RecursiveHierarchy#",
  sideEffects: "@com.sap.vocabularies.Common.v1.SideEffects",
} as const;

type Annotations = Record<string, unknown>;

/**
 * Annotations of a target such as `ns.EntityContainer/Books` or `ns.Books/title`.
 */
export function annotationsOf(
  root: Record<string, unknown>,
  target: string,
): Annotations {
  const all = (root.$Annotations ?? {}) as Record<string, Annotations>;
  return all[target] ?? {};
}

export interface SetCapabilities {
  readable: boolean;
  insertable: boolean;
  updatable: boolean;
  deletable: boolean;
  searchable: boolean;
  /** Properties that must not be used in $filter; undefined means unrestricted */
  nonFilterable: string[];
  nonSortable: string[];
  /** Properties the service sets itself on create, from InsertRestrictions */
  nonInsertable: string[];
  /** Properties that have to be given on create, from InsertRestrictions */
  requiredOnInsert: string[];
  nonUpdatable: string[];
  /** `$expand` is refused for these navigation properties (all of them if `expandable` is false) */
  nonExpandable: string[];
  expandable: boolean;
  /** `$count` is supported (default true) */
  countable: boolean;
  /** `$top` and `$skip` are supported (default true) */
  pageable: boolean;
  etag: boolean;
}

function restriction(
  annotations: Annotations,
  term: string,
  flag: string,
): boolean {
  const value = annotations[term] as Record<string, unknown> | undefined;
  // `false` is the only value that disables an operation; absent means allowed
  return value?.[flag] !== false;
}

function propertyNames(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : (entry as Record<string, string>)?.$PropertyPath,
    )
    .filter((name): name is string => !!name);
}

/**
 * Evaluates Capabilities annotations on an entity set (CAP maps `@readonly`,
 * `@insertonly`, `@restrict` etc. to these).
 */
export function readSetCapabilities(
  setAnnotations: Annotations,
  typeAnnotations: Annotations,
): SetCapabilities {
  const filter = setAnnotations[TERM.filter] as
    | Record<string, unknown>
    | undefined;
  const sort = setAnnotations[TERM.sort] as Record<string, unknown> | undefined;
  const insert = setAnnotations[TERM.insert] as Record<string, unknown> | undefined;
  const update = setAnnotations[TERM.update] as Record<string, unknown> | undefined;
  const expand = setAnnotations[TERM.expand] as Record<string, unknown> | undefined;
  return {
    readable: restriction(setAnnotations, TERM.read, "Readable"),
    insertable: restriction(setAnnotations, TERM.insert, "Insertable"),
    updatable: restriction(setAnnotations, TERM.update, "Updatable"),
    deletable: restriction(setAnnotations, TERM.delete, "Deletable"),
    searchable: restriction(setAnnotations, TERM.search, "Searchable"),
    nonFilterable: propertyNames(filter?.NonFilterableProperties),
    nonSortable: propertyNames(sort?.NonSortableProperties),
    nonInsertable: propertyNames(insert?.NonInsertableProperties),
    requiredOnInsert: propertyNames(insert?.RequiredProperties),
    nonUpdatable: propertyNames(update?.NonUpdatableProperties),
    nonExpandable: propertyNames(expand?.NonExpandableProperties),
    expandable: restriction(setAnnotations, TERM.expand, "Expandable"),
    countable: restriction(setAnnotations, TERM.count, "Countable"),
    // TopSupported and SkipSupported are plain boolean terms; absent means supported
    pageable: setAnnotations[TERM.topSupported] !== false,
    etag: TERM.concurrency in typeAnnotations || TERM.concurrency in setAnnotations,
  };
}

export function readLabel(annotations: Annotations): string | undefined {
  const label = annotations[TERM.label];
  return typeof label === "string" ? label : undefined;
}

export function readDescription(annotations: Annotations): string | undefined {
  const description = annotations[TERM.description];
  return typeof description === "string" ? description : undefined;
}

export type FieldControl = "mandatory" | "optional" | "readOnly" | "inapplicable";

/**
 * Static `Common.FieldControl`. A path to another property makes the control depend on the
 * data, which cannot be told from metadata alone, so it is ignored.
 */
export function readFieldControl(annotations: Annotations): FieldControl | undefined {
  const value = annotations[TERM.fieldControl] as Record<string, unknown> | undefined;
  const member = value?.$EnumMember;
  if (typeof member !== "string") {
    return undefined;
  }
  switch (member.slice(member.lastIndexOf("/") + 1)) {
    case "Mandatory":
      return "mandatory";
    case "Optional":
      return "optional";
    case "ReadOnly":
      return "readOnly";
    case "Inapplicable":
    case "Hidden":
      return "inapplicable";
    default:
      return undefined;
  }
}

/** Path of the property holding the text of an ID (`Common.Text`), e.g. `name` for `code` */
export function readTextPath(annotations: Annotations): string | undefined {
  const value = annotations[TERM.text] as Record<string, unknown> | undefined;
  return typeof value?.$Path === "string" ? value.$Path : undefined;
}

export interface Validation {
  minimum?: number;
  maximum?: number;
  allowedValues?: (string | number)[];
}

export function readValidation(annotations: Annotations): Validation {
  const numeric = (value: unknown) => (typeof value === "number" ? value : undefined);
  const allowed = annotations[TERM.allowedValues];
  const values = Array.isArray(allowed)
    ? allowed
        .map((entry) => (entry as Record<string, unknown>)?.Value)
        .filter((value): value is string | number =>
          typeof value === "string" || typeof value === "number",
        )
    : [];
  return {
    minimum: numeric(annotations[TERM.minimum]),
    maximum: numeric(annotations[TERM.maximum]),
    allowedValues: values.length ? values : undefined,
  };
}

export interface AggregatableProperty {
  property: string;
  methods?: string[];
}

export interface AggregationSupport {
  /** `groupby`, `aggregate`, `filter` ... the transformations the service accepts */
  transformations: string[];
  /** Properties to group by; undefined means every property */
  groupable?: string[];
  /** Properties to aggregate with the methods allowed for each; undefined means every property */
  aggregatable?: AggregatableProperty[];
  /** Aggregates the service computes itself, e.g. `stockTotal` */
  customAggregates: { name: string; edmType: string }[];
}

/**
 * `Aggregation.ApplySupported` of an entity set (or its type) and the custom aggregates of
 * the type. Without the annotation the service does not promise `$apply` support.
 */
export function readAggregation(
  setAnnotations: Annotations,
  typeAnnotations: Annotations,
): AggregationSupport | undefined {
  const support = (setAnnotations[TERM.applySupported] ??
    typeAnnotations[TERM.applySupported]) as Record<string, unknown> | undefined;
  if (!support) {
    return undefined;
  }
  const aggregatable = support.AggregatableProperties;
  const customAggregates = [setAnnotations, typeAnnotations].flatMap((annotations) =>
    Object.entries(annotations)
      .filter(([term]) => term.startsWith(TERM.customAggregate))
      .map(([term, edmType]) => ({
        name: term.slice(TERM.customAggregate.length),
        edmType: typeof edmType === "string" ? edmType : "Edm.String",
      })),
  );
  return {
    transformations: Array.isArray(support.Transformations)
      ? (support.Transformations as string[])
      : [],
    groupable: Array.isArray(support.GroupableProperties)
      ? propertyNames(support.GroupableProperties)
      : undefined,
    aggregatable: Array.isArray(aggregatable)
      ? aggregatable
          .map((entry): AggregatableProperty | undefined => {
            const record = entry as Record<string, unknown>;
            const property = (record.Property as Record<string, string> | undefined)
              ?.$PropertyPath;
            const methods = record.SupportedAggregationMethods;
            return property
              ? {
                  property,
                  methods: Array.isArray(methods) ? (methods as string[]) : undefined,
                }
              : undefined;
          })
          .filter((entry): entry is AggregatableProperty => !!entry)
      : undefined,
    customAggregates,
  };
}

export interface HierarchyDescriptor {
  qualifier: string;
  nodeProperty: string;
  /** Navigation property to the parent node */
  parentNavigation: string;
  /** Foreign key property that holds the parent's node value, e.g. `parent_ID`; from the navigation's referential constraint */
  parentKey?: string;
  /** Computed columns the service fills for hierarchy queries (`DrillState` ...) */
  columns: Record<string, string>;
}

/** Recursive hierarchies declared on an entity type, one per qualifier */
export function readHierarchies(typeAnnotations: Annotations): HierarchyDescriptor[] {
  const result: HierarchyDescriptor[] = [];
  for (const [term, value] of Object.entries(typeAnnotations)) {
    if (!term.startsWith(TERM.recursiveHierarchy)) {
      continue;
    }
    const qualifier = term.slice(TERM.recursiveHierarchy.length);
    const record = value as Record<string, Record<string, string> | undefined>;
    const nodeProperty = record.NodeProperty?.$PropertyPath;
    const parentNavigation = record.ParentNavigationProperty?.$NavigationPropertyPath;
    if (!nodeProperty || !parentNavigation) {
      continue;
    }
    const columns = Object.fromEntries(
      Object.entries(
        (typeAnnotations[`${TERM.hierarchyColumns}${qualifier}`] ?? {}) as Record<
          string,
          unknown
        >,
      )
        .map(([name, column]) => [name, (column as Record<string, string>)?.$Path])
        .filter(([, path]) => typeof path === "string"),
    ) as Record<string, string>;
    result.push({ qualifier, nodeProperty, parentNavigation, columns });
  }
  return result;
}

export interface SideEffects {
  /** Navigation paths of entities the operation changes; "" is the entity itself */
  entities: string[];
  properties: string[];
}

/** `Common.SideEffects` (any qualifier) of an operation: what it says to reload afterwards */
export function readSideEffects(annotations: Annotations): SideEffects | undefined {
  const entities: string[] = [];
  const properties: string[] = [];
  let found = false;
  for (const [term, value] of Object.entries(annotations)) {
    if (term !== TERM.sideEffects && !term.startsWith(`${TERM.sideEffects}#`)) {
      continue;
    }
    found = true;
    const record = value as Record<string, unknown>;
    for (const entry of (record.TargetEntities as Record<string, string>[] | undefined) ?? []) {
      entities.push(entry.$NavigationPropertyPath ?? "");
    }
    for (const entry of (record.TargetProperties as unknown[] | undefined) ?? []) {
      properties.push(
        typeof entry === "string" ? entry : ((entry as Record<string, string>).$PropertyPath ?? ""),
      );
    }
  }
  return found ? { entities, properties } : undefined;
}

/**
 * `Core.OperationAvailable`: `false` always hides the operation, a path names a property
 * of the entry that says whether it is available for that entry.
 */
export function readOperationAvailable(
  annotations: Annotations,
): boolean | { path: string } | undefined {
  const value = annotations[TERM.operationAvailable];
  if (typeof value === "boolean") {
    return value;
  }
  const path = (value as Record<string, unknown> | undefined)?.$Path;
  return typeof path === "string" ? { path } : undefined;
}
