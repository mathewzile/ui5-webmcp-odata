import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  disallowedExpands,
  expandedNavigations,
  nonSortableIn,
  orderbyProperties,
  splitTopLevel,
} from "../src/ui5/webmcp/odata/metadata/QueryChecks";

describe("splitTopLevel", () => {
  it("does not split inside parentheses", () => {
    assert.deepEqual(splitTopLevel("a($select=x,y),b"), ["a($select=x,y)", "b"]);
  });

  it("ignores empty items", () => {
    assert.deepEqual(splitTopLevel("a,,b, "), ["a", "b"]);
  });
});

describe("orderby", () => {
  it("drops the direction", () => {
    assert.deepEqual(orderbyProperties("title desc, stock asc,price"), [
      "title",
      "stock",
      "price",
    ]);
  });

  it("finds properties the service does not allow sorting by", () => {
    assert.deepEqual(
      nonSortableIn("title, DrillState desc", ["DrillState", "LimitedRank"]),
      ["DrillState"],
    );
  });

  it("matches the first segment of a path", () => {
    assert.deepEqual(nonSortableIn("address/zip", ["address"]), ["address/zip"]);
  });

  it("allows everything without restrictions", () => {
    assert.deepEqual(nonSortableIn("title", []), []);
  });
});

describe("expand", () => {
  it("names the navigation properties, also with options and paths", () => {
    assert.deepEqual(
      expandedNavigations("chapters($select=title,number),author/books"),
      ["chapters", "author"],
    );
  });

  it("accepts navigation properties of the entity", () => {
    assert.deepEqual(
      disallowedExpands("chapters($top=2)", ["chapters", "author"]),
      [],
    );
  });

  it("rejects unknown navigations", () => {
    assert.deepEqual(disallowedExpands("chapters,nope", ["chapters"]), ["nope"]);
  });

  it("rejects draft administration and the wildcard", () => {
    assert.deepEqual(
      disallowedExpands("DraftAdministrativeData,SiblingEntity,*", [
        "DraftAdministrativeData",
        "SiblingEntity",
      ]),
      ["DraftAdministrativeData", "SiblingEntity", "*"],
    );
  });
});
