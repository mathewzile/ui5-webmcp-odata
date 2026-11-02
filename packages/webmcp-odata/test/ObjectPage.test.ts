import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { objectPagePath } from "../src/ui5/webmcp/odata/metadata/ObjectPage";

const sets = ["Books", "Chapters"];

describe("objectPagePath", () => {
  it("reads the entry of an object page", () => {
    assert.deepEqual(objectPagePath("Books(ID=1,IsActiveEntity=true)", sets), {
      entitySet: "Books",
      path: "/Books(ID=1,IsActiveEntity=true)",
    });
  });

  it("ignores leading slashes and the query part", () => {
    assert.equal(
      objectPagePath("/Books(ID=1,IsActiveEntity=false)?sap-iapp-state=A", sets)?.path,
      "/Books(ID=1,IsActiveEntity=false)",
    );
  });

  it("follows sub pages", () => {
    assert.equal(
      objectPagePath("Books(ID=1,IsActiveEntity=true)/chapters(ID=2,IsActiveEntity=true)", sets)
        ?.path,
      "/Books(ID=1,IsActiveEntity=true)/chapters(ID=2,IsActiveEntity=true)",
    );
  });

  it("is undefined for list pages, empty hashes and unknown sets", () => {
    assert.equal(objectPagePath("", sets), undefined);
    assert.equal(objectPagePath("Books", sets), undefined);
    assert.equal(objectPagePath("Nothing(ID=1)", sets), undefined);
    assert.equal(objectPagePath("Books(ID=1)/title", sets), undefined);
  });
});
