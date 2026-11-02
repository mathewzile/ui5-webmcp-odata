import type { JsonSchema } from "./JsonSchema";

const MAX_ERRORS = 10;

function typeOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeOf(value) === type;
  }
}

/**
 * Checks a value against the subset of JSON Schema the generated tool inputs use: type, enum,
 * required, properties, items, minimum, maximum, maxLength, maxItems and pattern. Needed by the
 * generic tools, whose own input schema cannot describe the per-set input.
 *
 * @returns what is wrong, as `path: message`; empty if the value is valid
 */
export function validate(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < MAX_ERRORS) {
      errors.push(`${path}: ${message}`);
    }
  };

  const type = schema.type as string | string[] | undefined;
  if (type) {
    const types = [type].flat();
    if (!types.some((candidate) => matchesType(candidate, value))) {
      add(`expected ${types.join(" or ")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  const members = schema.enum as unknown[] | undefined;
  if (members && !members.some((member) => member === value)) {
    add(`must be one of ${members.map((member) => JSON.stringify(member)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      add(`longer than ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      add(`does not match ${schema.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      add(`less than ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      add(`greater than ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      add(`more than ${schema.maxItems} entries`);
    }
    const items = schema.items as JsonSchema | undefined;
    if (items) {
      for (const [index, item] of value.entries()) {
        for (const error of validate(items, item, `${path}[${index}]`)) {
          if (errors.length < MAX_ERRORS) {
            errors.push(error);
          }
        }
      }
    }
  }
  if (typeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (record[name] === undefined) {
        add(`missing ${name}`);
      }
    }
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (record[name] !== undefined) {
        for (const error of validate(propertySchema, record[name], `${path}.${name}`)) {
          if (errors.length < MAX_ERRORS) {
            errors.push(error);
          }
        }
      }
    }
  }
  return errors;
}
