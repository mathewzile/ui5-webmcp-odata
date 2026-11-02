/** The ETag of an entity as read from the model, before `clean` removes it */
export function etagOf(entity: unknown): string | undefined {
  const etag = (entity as Record<string, unknown> | undefined)?.["@odata.etag"];
  return typeof etag === "string" ? etag : undefined;
}

/**
 * Compares the ETag the agent read earlier with the current one.
 * Without an ETag from the agent there is nothing to compare (the model's own
 * `If-Match` still protects against changes between our read and our write).
 */
export function etagMismatch(expected: unknown, entity: unknown): boolean {
  return typeof expected === "string" && etagOf(entity) !== expected;
}
