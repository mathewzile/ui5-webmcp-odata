function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns changes to complex-typed properties into property paths. `setProperty` changes one
 * primitive property, so `{ address: { street: "x" } }` has to become `address/street`.
 * Only the given complex properties are opened up; other values are passed on as they are.
 */
export function flattenChanges(
  changes: Record<string, unknown>,
  complexNames: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const add = (path: string, value: unknown) => {
    if (isPlainObject(value)) {
      for (const [name, nested] of Object.entries(value)) {
        add(`${path}/${name}`, nested);
      }
    } else {
      result[path] = value;
    }
  };
  for (const [name, value] of Object.entries(changes)) {
    if (complexNames.includes(name)) {
      add(name, value);
    } else {
      result[name] = value;
    }
  }
  return result;
}
