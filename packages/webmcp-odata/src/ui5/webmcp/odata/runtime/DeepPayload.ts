import { DRAFT_PROPERTIES } from "../metadata/Writable";
import type {
  CompositionDescriptor,
  PropertyDescriptor,
} from "../metadata/ServiceIntrospector";

type Input = Record<string, unknown>;

/** Properties of a composition child the caller may set; the key to the parent is filled by the server */
export function childProperties(
  composition: CompositionDescriptor,
): PropertyDescriptor[] {
  return composition.properties.filter(
    (prop) =>
      !prop.computed &&
      !prop.unsupported &&
      !DRAFT_PROPERTIES.has(prop.name) &&
      prop.fieldControl !== "readOnly" &&
      prop.fieldControl !== "inapplicable" &&
      !composition.foreignKeys.includes(prop.name),
  );
}

/** Key properties that identify a child within its parent (not the foreign key, not IsActiveEntity) */
export function childKeyNames(composition: CompositionDescriptor): string[] {
  return composition.properties
    .filter(
      (prop) =>
        prop.isKey &&
        prop.name !== "IsActiveEntity" &&
        !composition.foreignKeys.includes(prop.name),
    )
    .map((prop) => prop.name);
}

function isDraft(composition: CompositionDescriptor): boolean {
  return composition.properties.some((prop) => prop.name === "IsActiveEntity");
}

/**
 * Body for creating a child (and its own children): only allowed properties,
 * unknown ones are dropped, draft levels are created as active data.
 */
export function childPayload(
  composition: CompositionDescriptor,
  value: unknown,
): Input | Input[] {
  const names = childProperties(composition).map((prop) => prop.name);
  const one = (child: Input): Input => {
    const payload: Input = {};
    for (const name of names) {
      if (child[name] !== undefined) {
        payload[name] = child[name];
      }
    }
    for (const nested of composition.compositions) {
      if (child[nested.name] !== undefined) {
        payload[nested.name] = childPayload(nested, child[nested.name]);
      }
    }
    return isDraft(composition) ? { ...payload, IsActiveEntity: true } : payload;
  };
  return Array.isArray(value)
    ? value.map((child) => one(child as Input))
    : one(value as Input);
}

/** Names of all entity types below the compositions, for refreshing the matching sets */
export function compositionTypeNames(
  compositions: CompositionDescriptor[],
): string[] {
  return [
    ...new Set(
      compositions.flatMap((composition) => [
        composition.typeName,
        ...compositionTypeNames(composition.compositions),
      ]),
    ),
  ];
}

/**
 * `$expand` that loads the levels the input mentions, e.g. `chapters($expand=sections)`;
 * empty if none of the compositions is part of the input.
 */
export function expandFor(
  compositions: CompositionDescriptor[],
  input: Input,
): string {
  const parts: string[] = [];
  for (const composition of compositions) {
    const value = input[composition.name];
    if (value === undefined) {
      continue;
    }
    // Every entry may bring its own deeper levels; load all that any entry mentions
    const entries = (Array.isArray(value) ? value : [value]) as Input[];
    const nested = composition.compositions
      .map((child) => {
        const deeper = entries
          .filter((entry) => entry?.[child.name] !== undefined)
          .flatMap((entry) => [entry[child.name]].flat());
        return deeper.length ? expandFor([child], { [child.name]: deeper }) : "";
      })
      .filter(Boolean);
    parts.push(
      nested.length
        ? `${composition.name}($expand=${nested.join(",")})`
        : composition.name,
    );
  }
  return parts.join(",");
}

/** The sets whose bindings show data written through the compositions of `set`, itself included */
export function refreshSetNames(
  set: { name: string; compositions: CompositionDescriptor[] },
  allSets: { name: string; typeName: string }[],
): string[] {
  const types = compositionTypeNames(set.compositions);
  return [
    set.name,
    ...allSets.filter((other) => types.includes(other.typeName)).map((other) => other.name),
  ];
}
