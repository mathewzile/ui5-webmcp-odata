import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToRoot } from "../src/ui5/webmcp/odata/metadata/DraftRoot";
import type { EntitySetDescriptor } from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";

function set(overrides: Partial<EntitySetDescriptor>): EntitySetDescriptor {
  return {
    navigationProperties: [],
    compositions: [],
    draftRoot: false,
    draftNode: false,
    ...overrides,
  } as EntitySetDescriptor;
}

const books = set({
  name: "Books",
  typeName: "ns.Book",
  draftRoot: true,
  compositions: [
    { name: "chapters", typeName: "ns.Chapter", partner: "book" },
  ] as EntitySetDescriptor["compositions"],
});
const chapters = set({
  name: "Chapters",
  typeName: "ns.Chapter",
  draftNode: true,
  navigationProperties: [
    { name: "book", target: "ns.Book", isCollection: false },
    { name: "sections", target: "ns.Section", isCollection: true },
  ] as EntitySetDescriptor["navigationProperties"],
  compositions: [
    { name: "sections", typeName: "ns.Section", partner: "chapter" },
  ] as EntitySetDescriptor["compositions"],
});
const sections = set({
  name: "Sections",
  typeName: "ns.Section",
  draftNode: true,
  navigationProperties: [
    { name: "chapter", target: "ns.Chapter", isCollection: false },
  ] as EntitySetDescriptor["navigationProperties"],
});
const all = [books, chapters, sections];

describe("pathToRoot", () => {
  it("is undefined for a root and for sets without drafts", () => {
    assert.equal(pathToRoot(books, all), undefined);
    assert.equal(pathToRoot(set({ name: "Authors" }), all), undefined);
  });

  it("finds the root one level up", () => {
    assert.deepEqual(pathToRoot(chapters, all), {
      root: books,
      navigations: ["book"],
    });
  });

  it("follows several levels", () => {
    assert.deepEqual(pathToRoot(sections, all), {
      root: books,
      navigations: ["chapter", "book"],
    });
  });

  it("gives up if no back reference leads to a root", () => {
    assert.equal(pathToRoot(sections, [sections, chapters]), undefined);
  });
});
