type Row = Record<string, unknown>;

export interface ChildUpdate {
  /** Position in the list of existing children */
  index: number;
  /** The entry of the caller */
  desired: Row;
  /** Only the properties whose value differs from the existing child */
  changes: Row;
}

export interface ChildDiff {
  updates: ChildUpdate[];
  creates: Row[];
  /** Positions of existing children that are not in the new list */
  deletes: number[];
}

function keyOf(row: Row, keyNames: string[]): string | undefined {
  const values = keyNames.map((name) => row[name]);
  return keyNames.length && values.every((value) => value !== undefined && value !== null)
    ? JSON.stringify(values.map(String))
    : undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares the new list of children with the existing ones the way a CAP deep update does:
 * children are matched by key, new ones are created, the rest is deleted.
 *
 * @param keyNames key properties of the child (without the foreign key to the parent)
 * @param properties properties that are compared and changed; compositions are handled by the caller
 */
export function diffChildren(
  keyNames: string[],
  properties: string[],
  existing: Row[],
  desired: Row[],
): ChildDiff {
  const positions = new Map<string, number>();
  existing.forEach((row, index) => {
    const key = keyOf(row, keyNames);
    if (key !== undefined) {
      positions.set(key, index);
    }
  });
  const matched = new Set<number>();
  const diff: ChildDiff = { updates: [], creates: [], deletes: [] };
  for (const entry of desired) {
    const key = keyOf(entry, keyNames);
    const index = key === undefined ? undefined : positions.get(key);
    if (index === undefined) {
      diff.creates.push(entry);
      continue;
    }
    if (matched.has(index)) {
      throw new Error(`The key ${key} is given twice`);
    }
    matched.add(index);
    const changes: Row = {};
    for (const name of properties) {
      if (entry[name] !== undefined && !same(existing[index][name], entry[name])) {
        changes[name] = entry[name];
      }
    }
    diff.updates.push({ index, desired: entry, changes });
  }
  existing.forEach((_, index) => {
    if (!matched.has(index)) {
      diff.deletes.push(index);
    }
  });
  return diff;
}
