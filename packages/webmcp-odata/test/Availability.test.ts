import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAvailableFor,
  refreshTargets,
} from "../src/ui5/webmcp/odata/metadata/Availability";
import type {
  EntitySetDescriptor,
  OperationDescriptor,
} from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";

const operation = (overrides: Partial<OperationDescriptor>) =>
  ({ name: "close", ...overrides }) as OperationDescriptor;

const sets = [
  {
    name: "Books",
    typeName: "ns.Book",
    navigationProperties: [{ name: "chapters", target: "ns.Chapter" }],
  },
  { name: "Chapters", typeName: "ns.Chapter", navigationProperties: [] },
  { name: "Archive", typeName: "ns.Chapter", navigationProperties: [] },
] as unknown as EntitySetDescriptor[];

describe("refreshTargets", () => {
  it("refreshes everything if the service names no side effects or the operation is unbound", () => {
    assert.equal(refreshTargets(operation({}), sets[0], sets), undefined);
    assert.equal(
      refreshTargets(
        operation({ sideEffects: { entities: [""], properties: [] } }),
        undefined,
        sets,
      ),
      undefined,
    );
  });

  it("refreshes the own set and the sets of the named navigations", () => {
    assert.deepEqual(
      refreshTargets(
        operation({ sideEffects: { entities: ["chapters/sections"], properties: [] } }),
        sets[0],
        sets,
      ),
      ["Books", "Chapters", "Archive"],
    );
  });

  it("refreshes only the own set for property side effects", () => {
    assert.deepEqual(
      refreshTargets(
        operation({ sideEffects: { entities: [], properties: ["stock"] } }),
        sets[0],
        sets,
      ),
      ["Books"],
    );
  });
});

describe("isAvailableFor", () => {
  it("is available without annotation or with true", () => {
    assert.ok(isAvailableFor(operation({}), {}));
    assert.ok(isAvailableFor(operation({ available: true }), {}));
  });

  it("is never available if the annotation is false", () => {
    assert.ok(!isAvailableFor(operation({ available: false }), {}));
  });

  it("follows the property named by a path, unknown counts as available", () => {
    const op = operation({ available: { path: "canClose" } });
    assert.ok(!isAvailableFor(op, { canClose: false }));
    assert.ok(isAvailableFor(op, { canClose: true }));
    assert.ok(isAvailableFor(op, {}));
    assert.ok(isAvailableFor(op, { canClose: null }));
  });

  it("skips the binding parameter at the start of a path", () => {
    const op = operation({ available: { path: "in/hasStock" } });
    assert.ok(!isAvailableFor(op, { hasStock: false }));
    assert.ok(isAvailableFor(op, { hasStock: true }));
    assert.ok(isAvailableFor(op, {}));
    const nested = operation({ available: { path: "in/status/open" } });
    assert.ok(!isAvailableFor(nested, { status: { open: false } }));
  });
});
