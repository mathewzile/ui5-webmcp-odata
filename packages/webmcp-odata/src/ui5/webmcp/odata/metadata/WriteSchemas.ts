import { compositionSchemas } from "./DeepSchema";
import { objectSchema, propertySchema, type JsonSchema } from "./JsonSchema";
import type { EntitySetDescriptor } from "./ServiceIntrospector";
import {
  changeableProperties,
  createProperties,
  requiredOnCreate,
  userKeyNames,
} from "./Writable";

/** Schemas of the key properties the caller has to give */
export function keySchemas(set: EntitySetDescriptor): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const name of userKeyNames(set)) {
    const prop = set.properties.find((candidate) => candidate.name === name)!;
    schemas[name] = propertySchema(prop);
  }
  return schemas;
}

/** Optional `etag` input for sets with optimistic concurrency */
export function etagSchema(set: EntitySetDescriptor): Record<string, JsonSchema> {
  return set.etag
    ? {
        etag: {
          type: "string",
          description:
            "The 'etag' of the result where you read the entry. If given, the call fails with reason 'precondition' when the entry was changed since, instead of overwriting that change",
        },
      }
    : {};
}

/** One entry to create, children included */
export function createItemSchema(set: EntitySetDescriptor): JsonSchema {
  const writable = createProperties(set);
  return objectSchema(
    {
      ...Object.fromEntries(writable.map((prop) => [prop.name, propertySchema(prop)])),
      ...compositionSchemas(set.compositions, "create"),
    },
    // Generated keys (computedDefault) may be left out, the server fills them
    requiredOnCreate(set, writable),
  );
}

/** The `changes` of an update: changeable properties and lists of children */
export function changesSchema(set: EntitySetDescriptor): JsonSchema {
  return objectSchema({
    ...Object.fromEntries(
      changeableProperties(set).map((prop) => [prop.name, propertySchema(prop)]),
    ),
    ...compositionSchemas(set.compositions, "update"),
  });
}

/** One entry to update: its keys, the changes and, if the set has an ETag, the ETag read before */
export function updateItemSchema(set: EntitySetDescriptor): JsonSchema {
  return objectSchema(
    { ...keySchemas(set), changes: changesSchema(set), ...etagSchema(set) },
    [...userKeyNames(set), "changes"],
  );
}

/** One entry to delete */
export function deleteItemSchema(set: EntitySetDescriptor): JsonSchema {
  return objectSchema({ ...keySchemas(set), ...etagSchema(set) }, userKeyNames(set));
}
