import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenChanges } from "../src/ui5/webmcp/odata/runtime/Flatten";
import { limitResult } from "../src/ui5/webmcp/odata/runtime/Limit";

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: index, text: "x".repeat(50) }));

describe("limitResult", () => {
  it("leaves a small result alone", () => {
    const result = { ok: true, data: rows(2) };
    assert.equal(limitResult(result, 10_000), result);
  });

  it("is off for a limit of 0", () => {
    const result = { ok: true, data: rows(500) };
    assert.equal(limitResult(result, 0), result);
  });

  it("cuts a list from the end and says so", () => {
    const result = { ok: true, data: rows(100) };
    const limited = limitResult(result, 1_000);
    assert.equal(limited.truncated, true);
    assert.equal(limited.hasMore, true);
    assert.ok(limited.returned! > 0 && limited.returned! < 100);
    assert.equal((limited.data as unknown[]).length, limited.returned);
    assert.ok(JSON.stringify(limited).length <= 1_000);
    // the rows that are left are the first ones, in order
    assert.deepEqual((limited.data as { id: number }[])[0], { id: 0, text: "x".repeat(50) });
  });

  it("returns as many rows as fit", () => {
    const limited = limitResult({ ok: true, data: rows(100) }, 1_000);
    const next = JSON.stringify({
      ...limited,
      data: rows(limited.returned! + 1),
      returned: limited.returned! + 1,
    }).length;
    assert.ok(next > 1_000, "one more row would not fit");
  });

  it("turns an oversized single entry into a failure that explains what to do", () => {
    const input: { ok: boolean; data?: unknown; reason?: string; error?: string } = {
      ok: true,
      data: { blob: "x".repeat(500) },
    };
    const limited = limitResult(input, 100);
    assert.equal(limited.ok, false);
    assert.equal(limited.reason, "tooLarge");
    assert.equal(limited.data, undefined);
    assert.match(limited.error!, /select/);
  });
});

describe("flattenChanges", () => {
  it("opens up complex properties to paths", () => {
    assert.deepEqual(
      flattenChanges(
        { title: "t", address: { street: "Main", country: { code: "DE" } } },
        ["address"],
      ),
      { title: "t", "address/street": "Main", "address/country/code": "DE" },
    );
  });

  it("passes other values on, also objects of properties that are not complex", () => {
    assert.deepEqual(flattenChanges({ meta: { a: 1 }, tags: ["x"] }, ["address"]), {
      meta: { a: 1 },
      tags: ["x"],
    });
  });

  it("keeps null and arrays of a complex property whole", () => {
    assert.deepEqual(flattenChanges({ address: null, list: [1] }, ["address", "list"]), {
      address: null,
      list: [1],
    });
  });
});
