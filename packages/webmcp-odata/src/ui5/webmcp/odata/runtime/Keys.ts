import ODataUtils from "sap/ui/model/odata/v4/ODataUtils";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";

import { userKeyNames } from "../metadata/Writable";

export { DRAFT_PROPERTIES, userKeyNames } from "../metadata/Writable";

/**
 * Absolute path of a single entity, e.g. `/Books(ID=...,IsActiveEntity=true)`.
 * Values are formatted as OData literals according to the key's Edm type.
 */
export function entityPath(
  set: EntitySetDescriptor,
  keyValues: Record<string, unknown>,
): string {
  const parts = userKeyNames(set).map((name) => {
    const value = keyValues[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing key property ${name}`);
    }
    const prop = set.properties.find((candidate) => candidate.name === name);
    return `${name}=${ODataUtils.formatLiteral(value as string, prop?.edmType ?? "Edm.String")}`;
  });
  if (set.draft) {
    parts.push("IsActiveEntity=true");
  }
  return `/${set.name}(${parts.join(",")})`;
}

export function pick(
  source: Record<string, unknown>,
  names: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of names) {
    if (source[name] !== undefined) {
      result[name] = source[name];
    }
  }
  return result;
}

/** Drops OData annotations such as `@odata.etag` and UI5 internals from an entity */
export function clean<T>(entity: T): T {
  if (entity === undefined) {
    return entity;
  }
  return JSON.parse(
    JSON.stringify(entity, (key, value: unknown) =>
      key.startsWith("@") ? undefined : value,
    ),
  ) as T;
}
