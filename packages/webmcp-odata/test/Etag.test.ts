import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etagMismatch, etagOf } from "../src/ui5/webmcp/odata/runtime/Etag";

describe("etagOf", () => {
  it("reads the OData ETag annotation", () => {
    assert.equal(etagOf({ "@odata.etag": 'W/"1"', title: "x" }), 'W/"1"');
  });

  it("is undefined for entities without one", () => {
    assert.equal(etagOf({ title: "x" }), undefined);
    assert.equal(etagOf(undefined), undefined);
  });
});

describe("etagMismatch", () => {
  const current = { "@odata.etag": 'W/"2"' };

  it("accepts the current ETag", () => {
    assert.equal(etagMismatch('W/"2"', current), false);
  });

  it("refuses a stale ETag", () => {
    assert.equal(etagMismatch('W/"1"', current), true);
  });

  it("compares nothing if the agent gave none", () => {
    assert.equal(etagMismatch(undefined, current), false);
  });

  it("refuses an ETag if the entity has none now", () => {
    assert.equal(etagMismatch('W/"1"', {}), true);
  });
});
