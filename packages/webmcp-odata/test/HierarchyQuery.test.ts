import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HierarchyDescriptor } from "../src/ui5/webmcp/odata/metadata/Capabilities";
import {
  hierarchyQuery,
  moveProblem,
} from "../src/ui5/webmcp/odata/metadata/HierarchyQuery";

const hierarchy: HierarchyDescriptor = {
  qualifier: "GenresHierarchy",
  nodeProperty: "ID",
  parentNavigation: "parent",
  parentKey: "parent_ID",
  columns: {},
};

describe("hierarchyQuery", () => {
  it("finds roots and children through the parent key", () => {
    assert.deepEqual(hierarchyQuery("roots", "Genres", hierarchy, { depth: 1 }), {
      filter: "parent_ID eq null",
    });
    assert.deepEqual(
      hierarchyQuery("children", "Genres", hierarchy, { nodeLiteral: "abc", depth: 1 }),
      { filter: "parent_ID eq abc" },
    );
  });

  it("uses the hierarchy transformations for tree and descendants", () => {
    assert.equal(
      hierarchyQuery("tree", "Genres", hierarchy, { depth: 2 }).apply,
      "com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/Genres,HierarchyQualifier='GenresHierarchy',NodeProperty='ID',Levels=2)",
    );
    assert.equal(
      hierarchyQuery("descendants", "Genres", hierarchy, { nodeLiteral: "abc", depth: 3 })
        .apply,
      "descendants($root/Genres,GenresHierarchy,ID,filter(ID eq abc),3)",
    );
  });

  it("needs a node for children and descendants", () => {
    assert.throws(() => hierarchyQuery("children", "Genres", hierarchy, { depth: 1 }), /needs a node/);
    assert.throws(() => hierarchyQuery("descendants", "Genres", hierarchy, { depth: 1 }), /needs a node/);
  });

  it("needs the parent key for the plain filters", () => {
    assert.throws(
      () => hierarchyQuery("roots", "Genres", { ...hierarchy, parentKey: undefined }, { depth: 1 }),
      /parent/,
    );
  });

  it("refuses names that are not identifiers", () => {
    assert.throws(
      () => hierarchyQuery("tree", "Genres", { ...hierarchy, qualifier: "a'b" }, { depth: 1 }),
      /cannot be used/,
    );
  });
});

describe("moveProblem", () => {
  const parentOf = new Map<string, string | null>([
    ["1", null],
    ["2", "1"],
    ["3", "2"],
    ["4", null],
  ]);

  it("allows moves to another branch or to the root", () => {
    assert.equal(moveProblem("3", "4", parentOf), undefined);
    assert.equal(moveProblem("3", null, parentOf), undefined);
    assert.equal(moveProblem("1", "4", parentOf), undefined);
  });

  it("refuses to move a node below itself or one of its descendants", () => {
    assert.equal(moveProblem("2", "2", parentOf), "self");
    assert.equal(moveProblem("1", "3", parentOf), "cycle");
    assert.equal(moveProblem("1", "2", parentOf), "cycle");
  });

  it("does not loop on broken data", () => {
    const loop = new Map<string, string | null>([["a", "b"], ["b", "a"]]);
    assert.equal(moveProblem("x", "a", loop), undefined);
  });
});
