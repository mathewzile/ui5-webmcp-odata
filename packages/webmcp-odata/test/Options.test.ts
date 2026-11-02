import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operationAllowed, unknownEntitySets } from "../src/ui5/webmcp/odata/Options";

describe("operationAllowed", () => {
  it("allows everything without a filter", () => {
    assert.ok(operationAllowed("addStock", undefined));
    assert.ok(operationAllowed("addStock", {}));
  });

  it("narrows by include and exclude", () => {
    assert.ok(operationAllowed("a", { include: ["a", "b"] }));
    assert.ok(!operationAllowed("c", { include: ["a", "b"] }));
    assert.ok(!operationAllowed("a", { exclude: ["a"] }));
    assert.ok(!operationAllowed("a", { include: ["a"], exclude: ["a"] }));
  });
});

describe("unknownEntitySets", () => {
  const known = ["Books", "Authors"];

  it("finds nothing if every mentioned set exists", () => {
    assert.deepEqual(
      unknownEntitySets(
        { include: ["Books"], exclude: ["Authors"], entitySets: { Books: {} } },
        known,
      ),
      [],
    );
  });

  it("reports typos from all three options once", () => {
    assert.deepEqual(
      unknownEntitySets(
        {
          include: ["Bokos"],
          exclude: ["Authers"],
          entitySets: { Bokos: { operations: ["query"] } },
        },
        known,
      ),
      ["Bokos", "Authers"],
    );
  });

  it("accepts empty options", () => {
    assert.deepEqual(unknownEntitySets({}, known), []);
  });
});

describe("actionNeedsConfirmation", () => {
  it("asks for all actions, none or the named ones", async () => {
    const { actionNeedsConfirmation } = await import("../src/ui5/webmcp/odata/Options");
    assert.ok(actionNeedsConfirmation("a", true));
    assert.ok(!actionNeedsConfirmation("a", false));
    assert.ok(!actionNeedsConfirmation("a", undefined));
    assert.ok(actionNeedsConfirmation("a", ["a", "b"]));
    assert.ok(!actionNeedsConfirmation("c", ["a", "b"]));
  });
});
