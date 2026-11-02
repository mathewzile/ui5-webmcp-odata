import { childProperties } from "../runtime/DeepPayload";
import { objectSchema, propertySchema, type JsonSchema } from "./JsonSchema";
import type { CompositionDescriptor } from "./ServiceIntrospector";

/**
 * Schema entries for the compositions of an entity.
 *
 * - `create`: children are created together with the parent.
 * - `update`: the array is the complete new list, like a deep PATCH in CAP. Children with a
 *   key that exists are updated, children without one (or with an unknown one) are created,
 *   existing children missing from the array are deleted. Leave the property out to keep the
 *   children as they are.
 */
export function compositionSchemas(
  compositions: CompositionDescriptor[],
  mode: "create" | "update",
): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const composition of compositions) {
    const properties = childProperties(composition);
    const item = objectSchema(
      {
        ...Object.fromEntries(
          properties.map((prop) => [prop.name, propertySchema(prop)]),
        ),
        ...compositionSchemas(composition.compositions, mode),
      },
      // Existing children are matched by key and may be partial; only new ones need everything
      mode === "create"
        ? properties
            .filter(
              (prop) =>
                (!prop.nullable && !prop.computedDefault) ||
                prop.fieldControl === "mandatory",
            )
            .map((prop) => prop.name)
        : [],
    );
    const type = composition.typeName.split(".").pop();
    const description =
      mode === "create"
        ? `${composition.name} (${type}) created together with the parent in one request`
        : `Complete list of ${composition.name} (${type}). Entries with a key that exists are updated (only the properties given), entries without a known key are created, existing entries missing here are DELETED. Leave out to keep them unchanged`;
    schemas[composition.name] = composition.isCollection
      ? { type: "array", items: item, description }
      : { ...item, description };
  }
  return schemas;
}
