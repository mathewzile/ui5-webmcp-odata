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
      "Author. Writer of the book. Valid values come from entity set Authors",
    );
  });

  it("adds no description for a plain required property", () => {
    assert.deepEqual(propertySchema(property({ nullable: false })), {
      type: "string",
    });
  });

  it("lets nullable properties be set to null, but never keys", () => {
    assert.deepEqual(propertySchema(property({})).type, ["string", "null"]);
    assert.equal(
      propertySchema(property({ isKey: true, nullable: true })).type,
      "string",
    );
  });

  it("turns validation bounds of numbers into schema bounds", () => {
    const schema = propertySchema(
      property({ edmType: "Edm.Int32", nullable: false, minimum: 0, maximum: 100 }),
    );
    assert.deepEqual(schema, { type: "integer", minimum: 0, maximum: 100 });
    // nullable numbers keep the bounds and do not repeat them in words
    const nullable = propertySchema(property({ edmType: "Edm.Int32", minimum: 1 }));
    assert.deepEqual(nullable, { type: ["integer", "null"], minimum: 1 });
  });

  it("describes bounds of decimals in words, because they are strings", () => {
    const schema = propertySchema(
      property({ edmType: "Edm.Decimal", nullable: false, minimum: 0, maximum: 99 }),
    );
    assert.equal(schema.description, "Minimum 0. Maximum 99");
    assert.equal(schema.minimum, undefined);
  });

  it("uses allowed values as an enum, but never overrides an enum type", () => {
    const allowed = propertySchema(
      property({ nullable: false, allowedValues: ["A", "B"] }),
    );
    assert.deepEqual(allowed, { type: "string", enum: ["A", "B"] });
    const both = propertySchema(
      property({ nullable: false, enumValues: ["X"], allowedValues: ["A"] }),
    );
    assert.deepEqual(both.enum, ["X"]);
  });

  it("says when the value help lists all valid values", () => {
    const schema = propertySchema(
      property({ nullable: false, valueListSet: "Statuses", valueListFixed: true }),
    );
    assert.equal(schema.description, "One of the entries of entity set Statuses");
  });

  it("adds null to the members of a nullable enum", () => {
    const schema = propertySchema(
      property({ enumValues: ["Open", "Closed"] }),
    );
    assert.deepEqual(schema.enum, ["Open", "Closed", null]);
  });

  it("maps collection properties to arrays of the item schema", () => {
    const schema = propertySchema(
      property({ edmType: "Edm.Int32", nullable: false, isCollection: true }),
    );
    assert.deepEqual(schema, { type: "array", items: { type: "integer" } });
  });

  it("describes complex types with their own properties", () => {
    const schema = propertySchema(
      property({
        name: "address",
        edmType: "ns.Address",
        nullable: false,
        complexProperties: [
          property({ name: "street", nullable: false }),
          property({ name: "zip", edmType: "Edm.Int32" }),
          property({ name: "photo", edmType: "Edm.Stream", unsupported: true }),
        ],
      }),
    );
    assert.deepEqual(schema, {
      type: "object",
      properties: {
        street: { type: "string" },
        zip: { type: ["integer", "null"] },
      },
      required: ["street"],
    });
  });
});

describe("decimal precision and scale", () => {
  const pattern = (precision?: number, scale?: number) =>
    new RegExp(edmToSchema("Edm.Decimal", { precision, scale }).pattern as string);

  it("bounds the digits before and after the decimal point", () => {
    const price = pattern(9, 2);
    assert.ok(price.test("1234567.89"));
    assert.ok(price.test("-5"));
    assert.ok(!price.test("12345678.9"), "too many integer digits");
    assert.ok(!price.test("1.234"), "too many fraction digits");
  });

  it("handles a scale of 0 and a scale equal to the precision", () => {
    assert.ok(pattern(5, 0).test("12345"));
    assert.ok(!pattern(5, 0).test("1.5"));
    assert.ok(pattern(3, 3).test("0.123"));
    assert.ok(!pattern(3, 3).test("1.123"));
  });

  it("accepts any decimal if the facets are missing or floating", () => {
    assert.ok(pattern(undefined, undefined).test("123456789.123456789"));
    assert.ok(pattern(9, undefined).test("1.123456"));
  });
});

describe("Edm.Duration", () => {
  it("accepts ISO 8601 durations only", () => {
    const duration = new RegExp(edmToSchema("Edm.Duration").pattern as string);
    assert.ok(duration.test("PT1H30M"));
    assert.ok(duration.test("P2DT3.5S"));
    assert.ok(!duration.test("1h30m"));
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
