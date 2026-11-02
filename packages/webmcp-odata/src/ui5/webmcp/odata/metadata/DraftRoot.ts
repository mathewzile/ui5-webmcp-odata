import type { EntitySetDescriptor } from "./ServiceIntrospector";

export interface RootPath {
  root: EntitySetDescriptor;
  /** To-one navigation properties from the node up to the root, e.g. `["chapter", "book"]` */
  navigations: string[];
}

/**
 * Follows the back references (partner of a composition) from a draft node to its draft
 * root, so changes to the node can be guarded by the root's draft state.
 * Returns undefined for sets that are not draft nodes or have no path to a root.
 */
export function pathToRoot(
  set: EntitySetDescriptor,
  allSets: EntitySetDescriptor[],
): RootPath | undefined {
  if (!set.draftNode) {
    return undefined;
  }
  const navigations: string[] = [];
  let current = set;
  const visited = new Set<string>();
  while (current.draftNode && !visited.has(current.name)) {
    visited.add(current.name);
    let next: { parent: EntitySetDescriptor; navigation: string } | undefined;
    for (const nav of current.navigationProperties) {
      if (nav.isCollection) {
        continue;
      }
      const parent = allSets.find(
        (candidate) =>
          candidate.typeName === nav.target &&
          candidate.compositions.some(
            (composition) =>
              composition.typeName === current.typeName &&
              // the composition's partner is this back reference
              composition.partner === nav.name,
          ),
      );
      if (parent) {
        next = { parent, navigation: nav.name };
        break;
      }
    }
    if (!next) {
      return undefined;
    }
    navigations.push(next.navigation);
    current = next.parent;
  }
  return current.draftRoot ? { root: current, navigations } : undefined;
}
