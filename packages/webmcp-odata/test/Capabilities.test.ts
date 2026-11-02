import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TERM,
  annotationsOf,
  readDescription,
  readLabel,
  readSetCapabilities,
} from "../src/ui5/webmcp/odata/metadata/Capabilities";

describe("readSetCapabilities", () => {
  it("allows everything without annotations", () => {
    assert.deepEqual(readSetCapabilities({}, {}), {
      readable: true,
      insertable: true,
      updatable: true,
      deletable: true,
      searchable: true,
      nonFilterable: [],
      nonSortable: [],
      nonInsertable: [],
      requiredOnInsert: [],
      nonUpdatable: [],
      nonExpandable: [],
      expandable: true,
      countable: true,
      pageable: true,
      etag: false,
    });
  });

  it("only `false` disables an operation", () => {
    const capabilities = readSetCapabilities(
      {
        [TERM.insert]: { Insertable: true },
        [TERM.update]: { Updatable: false },
        // restriction record without the flag: no restriction
        [TERM.delete]: { Description: "x" },
      },
      {},
    );
    assert.equal(capabilities.insertable, true);
    assert.equal(capabilities.updatable, false);
    assert.equal(capabilities.deletable, true);
  });

  it("reads non-filterable and non-sortable properties", () => {
    const capabilities = readSetCapabilities(
      {
        [TERM.filter]: { NonFilterableProperties: [{ $PropertyPath: "a" }, "b"] },
        [TERM.sort]: { NonSortableProperties: [{ $PropertyPath: "c" }] },
      },
      {},
    );
    assert.deepEqual(capabilities.nonFilterable, ["a", "b"]);
    assert.deepEqual(capabilities.nonSortable, ["c"]);
  });

  it("takes the ETag term from the type or the set", () => {
    assert.equal(readSetCapabilities({}, { [TERM.concurrency]: [] }).etag, true);
    assert.equal(readSetCapabilities({ [TERM.concurrency]: [] }, {}).etag, true);
  });
});

describe("annotation lookup", () => {
  it("returns annotations of a target, or none", () => {
    const root = { $Annotations: { "ns.Books/title": { [TERM.label]: "Title" } } };
    assert.equal(readLabel(annotationsOf(root, "ns.Books/title")), "Title");
    assert.deepEqual(annotationsOf(root, "ns.Books/other"), {});
    assert.deepEqual(annotationsOf({}, "ns.Books"), {});
  });

  it("ignores non-string labels and descriptions", () => {
    assert.equal(readLabel({ [TERM.label]: { $Path: "x" } }), undefined);
    assert.equal(readDescription({ [TERM.description]: "ok" }), "ok");
  });
});
