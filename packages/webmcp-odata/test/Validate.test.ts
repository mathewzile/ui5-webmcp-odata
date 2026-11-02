import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validate } from "../src/ui5/webmcp/odata/metadata/Validate";

describe("validate", () => {
  it("accepts a value that fits", () => {
    assert.deepEqual(
      validate(
        {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string", maxLength: 5 }, stock: { type: "integer", minimum: 0 } },
        },
        { title: "abc", stock: 3, extra: true },
      ),
      [],
    );
  });

  it("checks types, with null and several types", () => {
    assert.deepEqual(validate({ type: ["string", "null"] }, null), []);
    assert.match(validate({ type: "integer" }, 1.5)[0], /expected integer, got number/);
    assert.match(validate({ type: "string" }, 3)[0], /expected string, got number/);
    assert.match(validate({ type: "object" }, [])[0], /got array/);
  });

  it("checks enums, bounds, length and pattern", () => {
    assert.match(validate({ enum: ["a", "b"] }, "c")[0], /one of "a", "b"/);
    assert.match(validate({ type: "number", maximum: 1 }, 2)[0], /greater than 1/);
    assert.match(validate({ type: "number", minimum: 1 }, 0)[0], /less than 1/);
    assert.match(validate({ type: "string", maxLength: 2 }, "abc")[0], /longer than 2/);
    assert.match(validate({ type: "string", pattern: "^\\d+$" }, "x")[0], /does not match/);
  });

  it("reports missing required properties and the path of nested errors", () => {
    const schema = {
      type: "object",
      required: ["ID", "changes"],
      properties: {
        changes: { type: "object", properties: { stock: { type: "integer" } } },
        items: { type: "array", maxItems: 1, items: { type: "string" } },
      },
    };
    const errors = validate(schema, { changes: { stock: "x" }, items: ["a", 2] });
    assert.ok(errors.includes("input: missing ID"));
    assert.ok(errors.includes("input.changes.stock: expected integer, got string"));
    assert.ok(errors.includes("input.items[1]: expected string, got number"));
    assert.ok(errors.includes("input.items: more than 1 entries"));
  });

  it("stops after a few errors", () => {
    const errors = validate({ type: "array", items: { type: "string" } }, Array(50).fill(1));
    assert.equal(errors.length, 10);
  });
});
