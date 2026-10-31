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
  return {
    readable: restriction(setAnnotations, TERM.read, "Readable"),
    insertable: restriction(setAnnotations, TERM.insert, "Insertable"),
    updatable: restriction(setAnnotations, TERM.update, "Updatable"),
    deletable: restriction(setAnnotations, TERM.delete, "Deletable"),
    searchable: restriction(setAnnotations, TERM.search, "Searchable"),
    nonFilterable: propertyNames(filter?.NonFilterableProperties),
    nonSortable: propertyNames(sort?.NonSortableProperties),
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
