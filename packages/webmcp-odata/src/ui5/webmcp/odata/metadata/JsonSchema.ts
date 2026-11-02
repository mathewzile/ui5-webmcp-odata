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
  facets: {
    maxLength?: number;
    precision?: number;
    scale?: number;
    enumValues?: string[];
  } = {},
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
      return { type: "string", pattern: decimalPattern(facets) };
    case "Edm.Duration":
      return {
        type: "string",
        pattern: "^-?P(\\d+D)?(T(\\d+H)?(\\d+M)?(\\d+(\\.\\d+)?S)?)?$",
        description: "ISO 8601 duration, e.g. PT1H30M",
      };
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

/** Precision and scale bound the digits; without them any decimal number is accepted */
function decimalPattern(facets: { precision?: number; scale?: number }): string {
  const { precision, scale } = facets;
  if (!precision || scale === undefined || scale > precision) {
    return "^-?\\d+(\\.\\d+)?$";
  }
  const integerDigits = precision - scale;
  const integer = integerDigits > 0 ? `\\d{1,${integerDigits}}` : "0";
  return scale > 0
    ? `^-?${integer}(\\.\\d{1,${scale}})?$`
    : `^-?${integer}$`;
}

/** Lets `null` through, so a nullable property can be cleared */
function allowNull(schema: JsonSchema): JsonSchema {
  const type = schema.type;
  if (typeof type !== "string") {
    return schema;
  }
  return {
    ...schema,
    type: [type, "null"],
    ...(Array.isArray(schema.enum) ? { enum: [...schema.enum, null] } : {}),
  };
}

export function propertySchema(prop: PropertyDescriptor): JsonSchema {
  let schema: JsonSchema = prop.complexProperties
    ? objectSchema(
        Object.fromEntries(
          prop.complexProperties
            .filter((nested) => !nested.unsupported)
            .map((nested) => [nested.name, propertySchema(nested)]),
        ),
        prop.complexProperties
          .filter((nested) => !nested.unsupported && !nested.nullable)
          .map((nested) => nested.name),
      )
    : edmToSchema(prop.edmType, {
        maxLength: prop.maxLength,
        precision: prop.precision,
        scale: prop.scale,
        enumValues: prop.enumValues,
      });
  // Validation annotations tighten the Edm type; enum types already list their members
  if (prop.allowedValues && !schema.enum) {
    schema = { ...schema, enum: prop.allowedValues };
  }
  const numeric = schema.type === "integer" || schema.type === "number";
  if (numeric) {
    schema = {
      ...schema,
      ...(prop.minimum !== undefined ? { minimum: prop.minimum } : {}),
      ...(prop.maximum !== undefined ? { maximum: prop.maximum } : {}),
    };
  }
  if (prop.isCollection) {
    schema = { type: "array", items: schema };
  }
  if (prop.nullable && !prop.isKey) {
    schema = allowNull(schema);
  }
  const notes = [prop.label, prop.description];
  if (prop.valueListSet) {
    notes.push(
      prop.valueListFixed
        ? `One of the entries of entity set ${prop.valueListSet}`
        : `Valid values come from entity set ${prop.valueListSet}`,
    );
  }
  // Bounds of decimals cannot go in the schema (they are strings), so say them in words
  if (!numeric) {
    if (prop.minimum !== undefined) {
      notes.push(`Minimum ${prop.minimum}`);
    }
    if (prop.maximum !== undefined) {
      notes.push(`Maximum ${prop.maximum}`);
    }
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
