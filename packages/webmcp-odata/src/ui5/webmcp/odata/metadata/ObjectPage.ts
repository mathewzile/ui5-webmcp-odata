/**
 * Absolute entity path of the object page in a Fiori elements URL hash, e.g.
 * `Books(ID=1,IsActiveEntity=true)?sap-iapp-state=x` gives `/Books(ID=1,IsActiveEntity=true)`.
 * Sub pages (`Books(...)/chapters(...)`) give the path of the deepest entry. Returns
 * undefined for list pages and for paths whose first segment is not a known entity set.
 */
export function objectPagePath(
  hash: string,
  entitySets: string[],
): { entitySet: string; path: string } | undefined {
  const route = hash.replace(/^#?\/?/, "").split("?")[0];
  const segments = route.split("/").filter(Boolean);
  const entitySet = segments[0]?.split("(")[0];
  if (!entitySet || !entitySets.includes(entitySet)) {
    return undefined;
  }
  // Every segment is an entry (`Name(keys)`), otherwise this is not an object page path
  if (!segments.every((segment) => /^[A-Za-z_][\w.]*\(.+\)$/.test(segment))) {
    return undefined;
  }
  return { entitySet, path: `/${segments.join("/")}` };
}
