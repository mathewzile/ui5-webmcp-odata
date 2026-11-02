import type {
  EntitySetDescriptor,
  PropertyDescriptor,
} from "./ServiceIntrospector";

/** Draft administration properties that clients never write */
export const DRAFT_PROPERTIES = new Set([
  "IsActiveEntity",
  "HasActiveEntity",
  "HasDraftEntity",
]);

/** The property is not offered for input at all, whatever the operation */
function neverWritten(prop: PropertyDescriptor): boolean {
  return (
    prop.computed ||
    prop.unsupported === true ||
    DRAFT_PROPERTIES.has(prop.name) ||
    // static field control: the service says nobody edits or even sees this field
    prop.fieldControl === "readOnly" ||
    prop.fieldControl === "inapplicable"
  );
}

/** Properties a caller may send when creating an entry */
export function createProperties(set: EntitySetDescriptor): PropertyDescriptor[] {
  return set.properties.filter(
    (prop) => !neverWritten(prop) && !set.nonInsertable.includes(prop.name),
  );
}

/**
 * Properties of a create call that must be present: non-nullable ones without a
 * server-generated default, mandatory fields and those named by InsertRestrictions.
 */
export function requiredOnCreate(
  set: EntitySetDescriptor,
  properties: PropertyDescriptor[],
): string[] {
  return properties
    .filter(
      (prop) =>
        (!prop.nullable && !prop.computedDefault) ||
        prop.fieldControl === "mandatory" ||
        set.requiredOnInsert.includes(prop.name),
    )
    .map((prop) => prop.name);
}

/** Properties a caller may change on an existing entry: keys, immutable and non-updatable ones are fixed */
export function changeableProperties(set: EntitySetDescriptor): PropertyDescriptor[] {
  return set.properties.filter(
    (prop) =>
      !neverWritten(prop) &&
      !prop.isKey &&
      !prop.immutable &&
      !set.nonUpdatable.includes(prop.name),
  );
}

/** Key properties the caller has to provide; IsActiveEntity is always `true` for us */
export function userKeyNames(set: EntitySetDescriptor): string[] {
  return set.keys.filter((key) => key !== "IsActiveEntity");
}

/**
 * Why `changes` of an update cannot be applied, judged on the names alone:
 * properties that are not changeable, or no change at all.
 */
export function invalidChanges(
  set: EntitySetDescriptor,
  changes: Record<string, unknown>,
): { reason: "notChangeable" | "noChanges"; message: string } | undefined {
  const allowed = [
    ...changeableProperties(set).map((prop) => prop.name),
    ...set.compositions.map((composition) => composition.name),
  ];
  const rejected = Object.keys(changes).filter((name) => !allowed.includes(name));
  if (rejected.length) {
    return {
      reason: "notChangeable",
      message: `Cannot change ${rejected.join(", ")}. Changeable: ${allowed.join(", ")}`,
    };
  }
  return Object.keys(changes).length
    ? undefined
    : { reason: "noChanges", message: "No changes given" };
}
