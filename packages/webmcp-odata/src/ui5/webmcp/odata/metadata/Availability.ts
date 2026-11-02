import type {
  EntitySetDescriptor,
  OperationDescriptor,
} from "./ServiceIntrospector";

/**
 * Entity sets to refresh after an operation, from its `Common.SideEffects`.
 * Returns undefined when the service says nothing (or the operation is unbound):
 * then everything is refreshed.
 */
export function refreshTargets(
  operation: OperationDescriptor,
  set: EntitySetDescriptor | undefined,
  allSets: EntitySetDescriptor[],
): string[] | undefined {
  if (!operation.sideEffects || !set) {
    return undefined;
  }
  const names = new Set([set.name]);
  for (const path of operation.sideEffects.entities) {
    // "" is the entity itself; for `a/b` the first navigation decides which set changed
    const navigation = set.navigationProperties.find(
      (nav) => nav.name === path.split("/")[0],
    );
    if (!navigation) {
      continue;
    }
    for (const candidate of allSets) {
      if (candidate.typeName === navigation.target) {
        names.add(candidate.name);
      }
    }
  }
  return [...names];
}

/** The loaded entry says whether an operation is available for it (`Core.OperationAvailable` with a path) */
export function isAvailableFor(
  operation: OperationDescriptor,
  entry: Record<string, unknown>,
): boolean {
  const available = operation.available;
  if (available === undefined || available === true) {
    return true;
  }
  if (available === false) {
    return false;
  }
  // The path starts at the binding parameter (`in/canClose`), the entry is what it points to
  const segments = available.path.split("/");
  const steps = segments.length > 1 ? segments.slice(1) : segments;
  let value: unknown = entry;
  for (const step of steps) {
    value = (value as Record<string, unknown> | undefined)?.[step];
  }
  // null/undefined means unknown: let the service decide
  return value !== false;
}
