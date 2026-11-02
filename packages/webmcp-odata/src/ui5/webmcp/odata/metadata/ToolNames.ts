/** WebMCP: 1-128 characters, ASCII alphanumeric, `_`, `-` or `.` */
const MAX_LENGTH = 128;
const INVALID_CHARACTERS = /[^A-Za-z0-9_.-]/g;

export interface NamedTool {
  name: string;
}

export interface NameProblem {
  /** Name the tool was built with */
  requested: string;
  /** Name it is registered under */
  assigned: string;
  reason: "invalidCharacters" | "tooLong" | "duplicate";
}

function sanitize(name: string): string {
  return name.replace(INVALID_CHARACTERS, "_").slice(0, MAX_LENGTH) || "tool";
}

/** Makes `base` unique by appending `_2`, `_3`, ... and stays within the length limit */
function uniqueName(base: string, taken: Set<string>): string {
  for (let counter = 2; ; counter++) {
    const suffix = `_${counter}`;
    const candidate = `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Makes every tool name valid and unique. Names are never dropped: an overloaded
 * operation or a clash between a prefix and an entity set gets a numbered suffix, so
 * no tool silently disappears. The first tool keeps the plain name.
 *
 * @returns the tools with their final names, and what had to be changed
 */
export function assignToolNames<T extends NamedTool>(
  tools: T[],
): { tools: T[]; problems: NameProblem[] } {
  const taken = new Set<string>();
  const problems: NameProblem[] = [];
  const result = tools.map((tool) => {
    const requested = tool.name;
    let assigned = sanitize(requested);
    let reason: NameProblem["reason"] | undefined;
    if (requested.length > MAX_LENGTH) {
      reason = "tooLong";
    } else if (assigned !== requested) {
      reason = "invalidCharacters";
    }
    if (taken.has(assigned)) {
      assigned = uniqueName(assigned, taken);
      reason = "duplicate";
    }
    taken.add(assigned);
    if (reason) {
      problems.push({ requested, assigned, reason });
    }
    return assigned === requested ? tool : { ...tool, name: assigned };
  });
  return { tools: result, problems };
}
