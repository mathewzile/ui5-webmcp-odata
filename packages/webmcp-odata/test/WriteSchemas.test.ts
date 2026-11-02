import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntitySetDescriptor } from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";
import {
  createItemSchema,
  deleteItemSchema,
  updateItemSchema,
} from "../src/ui5/webmcp/odata/metadata/WriteSchemas";

const prop = (name: string, extra = {}) => ({
  name,
  edmType: "Edm.String",
  nullable: true,
  isKey: false,
  computed: false,
  computedDefault: false,
  immutable: false,
  ...extra,
});
const set = {
  name: "Books",
  keys: ["ID", "IsActiveEntity"],
  etag: true,
  nonInsertable: [],
  requiredOnInsert: [],
  nonUpdatable: [],
  compositions: [],
  properties: [
    prop("ID", { isKey: true, nullable: false, computedDefault: true }),
    prop("title", { nullable: false }),
    prop("IsActiveEntity", { isKey: true, edmType: "Edm.Boolean", nullable: false }),
  ],
} as unknown as EntitySetDescriptor;

describe("write schemas", () => {
  it("require the non-generated properties on create", () => {
    const schema = createItemSchema(set) as any;
    assert.deepEqual(schema.required, ["title"]);
    assert.ok(!("IsActiveEntity" in schema.properties));
  });

  it("take keys, changes and the etag on update", () => {
    const schema = updateItemSchema(set) as any;
    assert.deepEqual(schema.required, ["ID", "changes"]);
    assert.deepEqual(Object.keys(schema.properties.changes.properties), ["title"]);
    assert.ok(schema.properties.etag);
  });

  it("take keys and the etag on delete", () => {
    const schema = deleteItemSchema(set) as any;
    assert.deepEqual(schema.required, ["ID"]);
    assert.ok(schema.properties.etag);
    const without = { ...set, etag: false } as EntitySetDescriptor;
    assert.ok(!("etag" in (deleteItemSchema(without) as any).properties));
    assert.ok(!("etag" in (updateItemSchema(without) as any).properties));
  });
});
