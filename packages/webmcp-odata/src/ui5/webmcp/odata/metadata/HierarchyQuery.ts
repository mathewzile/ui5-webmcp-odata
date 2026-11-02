import type { HierarchyDescriptor } from "./Capabilities";

export type HierarchyMode = "roots" | "tree" | "children" | "descendants" | "ancestors";

export interface HierarchyQuery {
  /** `$filter` of a plain query */
  filter?: string;
  /** Raw `$apply` for the modes the hierarchy vocabulary covers */
  apply?: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Query for a hierarchy read. `nodeLiteral` is the node's key value already written as an
 * OData literal. Roots and children are plain filters on the parent key, which every service
 * can answer; the tree and the descendants use the standard hierarchy transformations.
 * Ancestors are not a query: the tool follows the parent key upwards.
 */
export function hierarchyQuery(
  mode: Exclude<HierarchyMode, "ancestors">,
  setName: string,
  hierarchy: HierarchyDescriptor,
  options: { nodeLiteral?: string; depth: number },
): HierarchyQuery {
  const { qualifier, nodeProperty, parentKey } = hierarchy;
  if (![qualifier, nodeProperty, setName].every((name) => IDENTIFIER.test(name))) {
    throw new Error("The hierarchy annotation has names that cannot be used in a query");
  }
  if (mode !== "tree" && mode !== "roots" && options.nodeLiteral === undefined) {
    throw new Error(`The mode ${mode} needs a node`);
  }
  switch (mode) {
    case "roots":
    case "children": {
      if (!parentKey) {
        throw new Error("The service does not say which property holds the parent");
      }
      return {
        filter:
          mode === "roots"
            ? `${parentKey} eq null`
            : `${parentKey} eq ${options.nodeLiteral}`,
      };
    }
    case "tree":
      return {
        apply: `com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/${setName},HierarchyQualifier='${qualifier}',NodeProperty='${nodeProperty}',Levels=${options.depth})`,
      };
    case "descendants":
      return {
        apply: `descendants($root/${setName},${qualifier},${nodeProperty},filter(${nodeProperty} eq ${options.nodeLiteral}),${options.depth})`,
      };
  }
}

/**
 * Why a node cannot be moved below the given parent, judged on the parent keys of the
 * loaded nodes: a node cannot become its own parent or a child of one of its descendants.
 *
 * @param parentOf node value → parent node value (null for roots)
 */
export function moveProblem(
  node: string,
  newParent: string | null,
  parentOf: Map<string, string | null>,
): "self" | "cycle" | undefined {
  if (newParent === null) {
    return undefined;
  }
  if (newParent === node) {
    return "self";
  }
  const seen = new Set<string>();
  for (let current: string | null | undefined = newParent; current; ) {
    if (current === node) {
      return "cycle";
    }
    if (seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    current = parentOf.get(current);
  }
  return undefined;
}
