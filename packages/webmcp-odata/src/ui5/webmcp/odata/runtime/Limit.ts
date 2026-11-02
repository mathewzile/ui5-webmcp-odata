/** Result fields the limit reads or sets; `ToolResult` has them all */
interface Limitable {
  ok: boolean;
  data?: unknown;
  hasMore?: boolean;
  reason?: string;
  error?: string;
  truncated?: boolean;
  returned?: number;
}

type Limited<T> = T & Pick<Limitable, "truncated" | "returned" | "hasMore">;

/**
 * Keeps a tool result small enough for an agent's context. A list loses rows from the
 * end until it fits and says so (`truncated`, `returned`, `hasMore`), so the agent can
 * ask for the rest with `skip`. A single entry that is too large (e.g. with big expands)
 * cannot be cut sensibly and becomes a failure that tells the agent to select less.
 *
 * @param maxChars size of the serialized result; 0 or less switches the limit off
 */
export function limitResult<T extends Limitable>(
  result: T,
  maxChars: number,
): Limited<T> {
  if (maxChars <= 0 || JSON.stringify(result).length <= maxChars) {
    return result;
  }
  if (!Array.isArray(result.data)) {
    return {
      ...result,
      ok: false,
      data: undefined,
      reason: "tooLarge",
      error: `The result is larger than ${maxChars} characters. Use 'select' to return fewer properties or 'expand' less.`,
    };
  }
  const rows = result.data;
  const cut = (count: number): Limited<T> => ({
    ...result,
    data: rows.slice(0, count),
    truncated: true,
    returned: count,
    hasMore: true,
  });
  // Binary search for the largest number of rows that still fits, measured with the added fields
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(cut(middle)).length <= maxChars) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return cut(low);
}
