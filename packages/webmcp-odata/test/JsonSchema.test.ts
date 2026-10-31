import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edmToSchema,
  objectSchema,
  parameterSchema,
  propertySchema,
} from "../src/ui5/webmcp/odata/metadata/JsonSchema";
import type { PropertyDescriptor } from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";

function property(overrides: Partial<PropertyDescriptor>): PropertyDescriptor {
  return {
    name: "p",
    edmType: "Edm.String",
    nullable: true,
    isKey: false,
    computed: false,
    computedDefault: false,
    immutable: false,
    ...overrides,
  };
}

describe("edmToSchema", () => {
  it("maps Edm types to JSON Schema", () => {
    assert.deepEqual(edmToSchema("Edm.Boolean"), { type: "boolean" });
    assert.deepEqual(edmToSchema("Edm.Int32"), { type: "integer" });
    assert.deepEqual(edmToSchema("Edm.Double"), { type: "number" });
    assert.deepEqual(edmToSchema("Edm.Guid"), { type: "string", format: "uuid" });
    assert.deepEqual(edmToSchema("Edm.Date"), { type: "string", format: "date" });
    assert.deepEqual(edmToSchema("Edm.DateTimeOffset"), {
      type: "string",
      format: "date-time",
    });
  });

  it("uses strings for Int64 and Decimal, like the UI5 V4 model", () => {
    assert.equal(edmToSchema("Edm.Int64").type, "string");
    assert.equal(edmToSchema("Edm.Decimal").type, "string");
    const decimal = new RegExp(edmToSchema("Edm.Decimal").pattern as string);
    assert.ok(decimal.test("13.13"));
    assert.ok(decimal.test("-5"));
    assert.ok(!decimal.test("1,5"));
  });

  it("carries maxLength of strings", () => {
    assert.deepEqual(edmToSchema("Edm.String", { maxLength: 111 }), {
      type: "string",
      maxLength: 111,
    });
  });

  it("turns enum types into an enum", () => {
    assert.deepEqual(
      edmToSchema("ns.Status", { enumValues: ["Open", "Closed"] }),
      { type: "string", enum: ["Open", "Closed"] },
    );
  });

  it("falls back to a free-form object for complex types", () => {
    assert.deepEqual(edmToSchema("ns.Address"), { type: "object" });
  });
});

describe("propertySchema", () => {
  it("describes label, description, nullability and value help", () => {
    const schema = propertySchema(
      property({
        label: "Author",
        description: "Writer of the book",
        valueListSet: "Authors",
      }),
    );
    assert.equal(
      schema.description,
      "Author. Writer of the book. Valid values come from entity set Authors. nullable",
    );
  });

  it("adds no description for a plain required property", () => {
    assert.deepEqual(propertySchema(property({ nullable: false })), {
      type: "string",
    });
  });
});

describe("parameterSchema", () => {
  it("wraps collection parameters in an array", () => {
    assert.deepEqual(
      parameterSchema({
        name: "ids",
        edmType: "Edm.Int32",
        nullable: false,
        isCollection: true,
      }),
      { type: "array", items: { type: "integer" } },
    );
  });
});

describe("objectSchema", () => {
  it("omits `required` when nothing is required", () => {
    assert.deepEqual(objectSchema({ a: { type: "string" } }), {
      type: "object",
      properties: { a: { type: "string" } },
    });
  });

  it("lists required properties", () => {
    assert.deepEqual(objectSchema({ a: { type: "string" } }, ["a"]).required, [
      "a",
    ]);
  });
});
