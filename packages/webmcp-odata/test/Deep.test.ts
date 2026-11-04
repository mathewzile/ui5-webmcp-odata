import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compositionSchemas } from "../src/ui5/webmcp/odata/metadata/DeepSchema";
import type {
  CompositionDescriptor,
  PropertyDescriptor,
} from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";
import { diffChildren } from "../src/ui5/webmcp/odata/runtime/DeepDiff";
import {
  childKeyNames,
  childPayload,
  compositionTypeNames,
} from "../src/ui5/webmcp/odata/runtime/DeepPayload";

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

const sections: CompositionDescriptor = {
  name: "sections",
  typeName: "ns.Section",
  isCollection: true,
  foreignKeys: ["chapter_ID"],
  compositions: [],
  properties: [
    property("ID", { isKey: true, nullable: false, computedDefault: true }),
    property("chapter_ID"),
    property("text", { nullable: false }),
    property("IsActiveEntity", { isKey: true, nullable: false }),
  ],
};
const chapters: CompositionDescriptor = {
  name: "chapters",
  typeName: "ns.Chapter",
  isCollection: true,
  foreignKeys: ["book_ID"],
  compositions: [sections],
  properties: [
    property("ID", { isKey: true, nullable: false, computedDefault: true }),
    property("book_ID"),
    property("title", { nullable: false }),
    property("secret", { computed: true }),
    property("IsActiveEntity", { isKey: true, nullable: false }),
  ],
};

describe("childKeyNames", () => {
  it("leaves out the foreign key and IsActiveEntity", () => {
    assert.deepEqual(childKeyNames(chapters), ["ID"]);
  });
});

describe("childPayload", () => {
  it("filters every level and creates draft levels as active data", () => {
    const payload = childPayload(chapters, [
      {
        title: "One",
        secret: "x",
        book_ID: "other",
        extra: 1,
        sections: [{ text: "A", chapter_ID: "no", nope: true }],
      },
    ]);
    assert.deepEqual(payload, [
      {
        title: "One",
        IsActiveEntity: true,
        sections: [{ text: "A", IsActiveEntity: true }],
      },
    ]);
  });
});

describe("compositionTypeNames", () => {
  it("lists the types of all levels once", () => {
    assert.deepEqual(compositionTypeNames([chapters]).sort(), ["ns.Chapter", "ns.Section"]);
  });
});

describe("compositionSchemas", () => {
  it("nests the schemas and requires fields of new children on create", () => {
    const schema = compositionSchemas([chapters], "create").chapters as any;
    assert.equal(schema.type, "array");
    assert.deepEqual(schema.items.required, ["title"]);
    assert.deepEqual(schema.items.properties.sections.items.required, ["text"]);
    assert.ok(!("secret" in schema.items.properties));
    assert.ok(!("book_ID" in schema.items.properties));
  });

  it("requires nothing on update and warns that missing children are deleted", () => {
    const schema = compositionSchemas([chapters], "update").chapters as any;
    assert.equal(schema.items.required, undefined);
    assert.match(schema.description, /DELETED/);
    assert.ok(schema.items.properties.ID);
  });
});

describe("to-one compositions", () => {
  const cover: CompositionDescriptor = {
    name: "cover",
    typeName: "ns.Cover",
    isCollection: false,
    foreignKeys: ["book_ID"],
    compositions: [],
    properties: [
      property("ID", { isKey: true, nullable: false, computedDefault: true }),
      property("book_ID"),
      property("color"),
    ],
  };

  it("can be removed with null on update, but not on create", () => {
    const update = compositionSchemas([cover], "update").cover as { type: unknown; description: string };
    assert.deepEqual(update.type, ["object", "null"]);
    assert.match(update.description, /null DELETES/);
    const create = compositionSchemas([cover], "create").cover as { type: unknown };
    assert.equal(create.type, "object");
  });

  it("leaves null out of the body of a new parent", () => {
    const parent: CompositionDescriptor = { ...chapters, compositions: [cover] };
    const payload = childPayload(parent, { title: "T", cover: null }) as Record<string, unknown>;
    assert.ok(!("cover" in payload));
  });
});

describe("diffChildren", () => {
  const existing = [
    { ID: "a", title: "A" },
    { ID: "b", title: "B" },
    { ID: "c", title: "C" },
  ];
  const diff = (desired: Record<string, unknown>[]) =>
    diffChildren(["ID"], ["title"], existing, desired);

  it("updates matched children with only the changed properties", () => {
    const result = diff([
      { ID: "a", title: "A" },
      { ID: "b", title: "B2" },
      { ID: "c", title: "C" },
    ]);
    assert.deepEqual(
      result.updates.map((update) => [update.index, update.changes]),
      [
        [0, {}],
        [1, { title: "B2" }],
        [2, {}],
      ],
    );
    assert.deepEqual(result.creates, []);
    assert.deepEqual(result.deletes, []);
  });

  it("deletes existing children that are missing, like CAP", () => {
    assert.deepEqual(diff([{ ID: "b" }]).deletes, [0, 2]);
    assert.deepEqual(diff([]).deletes, [0, 1, 2]);
  });

  it("creates children without a key or with an unknown key", () => {
    const result = diff([{ title: "new" }, { ID: "zzz", title: "client key" }, { ID: "a" }]);
    assert.equal(result.creates.length, 2);
    assert.deepEqual(result.deletes, [1, 2]);
  });

  it("does not touch properties that are not given", () => {
    assert.deepEqual(diff([{ ID: "a" }]).updates[0].changes, {});
  });

  it("rejects the same key twice", () => {
    assert.throws(() => diff([{ ID: "a" }, { ID: "a" }]), /twice/);
  });

  it("treats numeric and string keys alike", () => {
    const result = diffChildren(["n"], [], [{ n: 1 }], [{ n: "1" }]);
    assert.equal(result.updates.length, 1);
    assert.deepEqual(result.deletes, []);
  });
});

describe("expandFor", () => {
  it("expands only the levels the input mentions", async () => {
    const { expandFor } = await import("../src/ui5/webmcp/odata/runtime/DeepPayload");
    assert.equal(expandFor([chapters], {}), "");
    assert.equal(expandFor([chapters], { chapters: [{ title: "x" }] }), "chapters");
    assert.equal(
      expandFor([chapters], { chapters: [{ title: "x" }, { sections: [{ text: "a" }] }] }),
      "chapters($expand=sections)",
    );
  });
});
