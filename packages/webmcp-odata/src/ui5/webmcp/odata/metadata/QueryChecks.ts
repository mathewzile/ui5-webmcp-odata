/** Navigation properties that expose draft administration; agents only see active data */
export const DRAFT_NAVIGATIONS = ["DraftAdministrativeData", "SiblingEntity"];

/** Splits on commas that are not inside parentheses, e.g. `a($select=x,y),b` gives two items */
export function splitTopLevel(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;
    }
    if (character === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  items.push(current.trim());
  return items.filter(Boolean);
}

/** Property paths of an `$orderby`, without the direction: `title desc, author/name` */
export function orderbyProperties(orderby: string): string[] {
  return splitTopLevel(orderby).map((item) => item.split(/\s+/)[0]);
}

/** Properties of an `$orderby` that the service does not allow sorting by */
export function nonSortableIn(orderby: string, nonSortable: string[]): string[] {
  if (!nonSortable.length) {
    return [];
  }
  return orderbyProperties(orderby).filter(
    (path) => nonSortable.includes(path) || nonSortable.includes(path.split("/")[0]),
  );
}

/** First navigation segments of an `$expand`: `chapters($select=title),author` gives chapters, author */
export function expandedNavigations(expand: string): string[] {
  return splitTopLevel(expand).map((item) => item.split(/[(/]/)[0].trim());
}

/**
 * Entries of an `$expand` that must not be followed: unknown navigation properties
 * (the service would answer with an unhelpful error) and draft administration.
 * `*` is refused too, because it would pull in the draft navigations.
 */
export function disallowedExpands(
  expand: string,
  navigationNames: string[],
): string[] {
  const allowed = navigationNames.filter(
    (name) => !DRAFT_NAVIGATIONS.includes(name),
  );
  return expandedNavigations(expand).filter((name) => !allowed.includes(name));
}
