import type {
  ParameterDescriptor,
  PropertyDescriptor,
} from "./ServiceIntrospector";

export type JsonSchema = Record<string, unknown>;

/**
 * Maps an Edm type to JSON Schema. Int64 and Decimal are strings because the
 * UI5 OData V4 model represents them as strings to keep precision.
 */
export function edmToSchema(
  edmType: string,
  facets: { maxLength?: number; enumValues?: string[] } = {},
): JsonSchema {
  if (facets.enumValues?.length) {
    return { type: "string", enum: facets.enumValues };
  }
  switch (edmType) {
    case "Edm.String": {
      const schema: JsonSchema = { type: "string" };
      if (facets.maxLength) {
        schema.maxLength = facets.maxLength;
      }
      return schema;
    }
    case "Edm.Guid":
      return { type: "string", format: "uuid" };
    case "Edm.Boolean":
      return { type: "boolean" };
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Int16":
    case "Edm.Int32":
      return { type: "integer" };
    case "Edm.Int64":
      return { type: "string", pattern: "^-?\\d+$" };
    case "Edm.Decimal":
      return { type: "string", pattern: "^-?\\d+(\\.\\d+)?$" };
    case "Edm.Double":
    case "Edm.Single":
      return { type: "number" };
    case "Edm.Date":
      return { type: "string", format: "date" };
    case "Edm.DateTimeOffset":
      return { type: "string", format: "date-time" };
    case "Edm.TimeOfDay":
      return { type: "string", format: "time" };
    case "Edm.Binary":
      return { type: "string", description: "Base64 encoded" };
    default:
      // Complex types and anything unknown: let the model pass a free-form object
      return { type: "object" };
  }
}

export function propertySchema(prop: PropertyDescriptor): JsonSchema {
  const schema = edmToSchema(prop.edmType, {
    maxLength: prop.maxLength,
    enumValues: prop.enumValues,
  });
  const notes = [prop.label, prop.description];
  if (prop.valueListSet) {
    notes.push(`Valid values come from entity set ${prop.valueListSet}`);
  }
  if (prop.nullable) {
    notes.push("nullable");
  }
  const description = notes.filter(Boolean).join(". ");
  return description ? { ...schema, description } : schema;
}

export function parameterSchema(parameter: ParameterDescriptor): JsonSchema {
  const item = edmToSchema(parameter.edmType, {
    maxLength: parameter.maxLength,
  });
  return parameter.isCollection ? { type: "array", items: item } : item;
}

/**
 * Builds an object schema. Tool inputs must be objects at the top level, so
 * arrays are always wrapped in a property.
 */
export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}
