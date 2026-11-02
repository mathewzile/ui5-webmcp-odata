import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EntitySetDescriptor,
  PropertyDescriptor,
} from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";
import {
  changeableProperties,
  createProperties,
  requiredOnCreate,
} from "../src/ui5/webmcp/odata/metadata/Writable";

function property(name: string, overrides: Partial<PropertyDescriptor> = {}): PropertyDescriptor {
  return {
    name,
    edmType: "Edm.String",
    nullable: true,
    isKey: false,
    computed: false,
    computedDefault: false,
    immutable: false,
    ...overrides,
  };
}

function entitySet(
  properties: PropertyDescriptor[],
  overrides: Partial<EntitySetDescriptor> = {},
): EntitySetDescriptor {
  return {
    name: "Things",
    typeName: "ns.Thing",
    keys: ["ID"],
    properties,
    nonInsertable: [],
    requiredOnInsert: [],
    nonUpdatable: [],
    ...overrides,
  } as EntitySetDescriptor;
}

const names = (properties: PropertyDescriptor[]) => properties.map((prop) => prop.name);

describe("createProperties", () => {
  it("leaves out computed, unsupported and draft administration properties", () => {
    const set = entitySet([
      property("title"),
      property("modifiedAt", { computed: true }),
      property("photo", { unsupported: true }),
      property("IsActiveEntity"),
    ]);
    assert.deepEqual(names(createProperties(set)), ["title"]);
  });

  it("leaves out what InsertRestrictions says the service sets itself", () => {
    const set = entitySet([property("title"), property("status")], {
      nonInsertable: ["status"],
    });
    assert.deepEqual(names(createProperties(set)), ["title"]);
  });

  it("leaves out fields that are statically read-only or not applicable", () => {
    const set = entitySet([
      property("a"),
      property("b", { fieldControl: "readOnly" }),
      property("c", { fieldControl: "inapplicable" }),
      property("d", { fieldControl: "mandatory" }),
    ]);
    assert.deepEqual(names(createProperties(set)), ["a", "d"]);
  });
});

describe("requiredOnCreate", () => {
  it("requires non-nullable properties without a generated default", () => {
    const set = entitySet([
      property("ID", { nullable: false, computedDefault: true }),
      property("name", { nullable: false }),
      property("note"),
    ]);
    assert.deepEqual(requiredOnCreate(set, createProperties(set)), ["name"]);
  });

  it("also requires mandatory fields and those named by InsertRestrictions", () => {
    const set = entitySet(
      [
        property("name", { fieldControl: "mandatory" }),
        property("title"),
        property("note"),
      ],
      { requiredOnInsert: ["title"] },
    );
    assert.deepEqual(requiredOnCreate(set, createProperties(set)), ["name", "title"]);
  });
});

describe("changeableProperties", () => {
  it("excludes keys, immutable and non-updatable properties", () => {
    const set = entitySet(
      [
        property("ID", { isKey: true }),
        property("createdAt", { immutable: true }),
        property("author_ID"),
        property("title"),
        property("stock"),
      ],
      { nonUpdatable: ["author_ID"] },
    );
    assert.deepEqual(names(changeableProperties(set)), ["title", "stock"]);
  });

  it("keeps properties that may be given on create but not changed afterwards", () => {
    const set = entitySet([property("status"), property("title")], {
      nonUpdatable: ["status"],
    });
    assert.deepEqual(names(createProperties(set)), ["status", "title"]);
    assert.deepEqual(names(changeableProperties(set)), ["title"]);
  });
});

describe("invalidChanges", () => {
  const set = entitySet(
    [property("ID", { isKey: true }), property("title"), property("author_ID")],
    {
      nonUpdatable: ["author_ID"],
      compositions: [{ name: "chapters" }] as EntitySetDescriptor["compositions"],
    },
  );

  it("accepts changeable properties and compositions", async () => {
    const { invalidChanges } = await import("../src/ui5/webmcp/odata/metadata/Writable");
    assert.equal(invalidChanges(set, { title: "x", chapters: [] }), undefined);
  });

  it("names what cannot be changed", async () => {
    const { invalidChanges } = await import("../src/ui5/webmcp/odata/metadata/Writable");
    const result = invalidChanges(set, { ID: "1", author_ID: "2" });
    assert.equal(result?.reason, "notChangeable");
    assert.match(result!.message, /ID, author_ID/);
    assert.match(result!.message, /Changeable: title, chapters/);
  });

  it("refuses an empty change", async () => {
    const { invalidChanges } = await import("../src/ui5/webmcp/odata/metadata/Writable");
    assert.equal(invalidChanges(set, {})?.reason, "noChanges");
  });
});
