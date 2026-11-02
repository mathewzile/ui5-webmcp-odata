import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignToolNames } from "../src/ui5/webmcp/odata/metadata/ToolNames";

const tools = (...names: string[]) => names.map((name) => ({ name }));

describe("assignToolNames", () => {
  it("leaves valid, unique names alone", () => {
    const { tools: result, problems } = assignToolNames(
      tools("Books.query", "Books.get", "app.describe_service"),
    );
    assert.deepEqual(
      result.map((tool) => tool.name),
      ["Books.query", "Books.get", "app.describe_service"],
    );
    assert.deepEqual(problems, []);
  });

  it("replaces characters WebMCP does not allow", () => {
    const { tools: result, problems } = assignToolNames(
      tools("Büchér query", "a/b"),
    );
    assert.deepEqual(
      result.map((tool) => tool.name),
      ["B_ch_r_query", "a_b"],
    );
    assert.deepEqual(
      problems.map((problem) => problem.reason),
      ["invalidCharacters", "invalidCharacters"],
    );
  });

  it("numbers duplicates, so overloads are all registered", () => {
    const { tools: result, problems } = assignToolNames(
      tools("Books.close", "Books.close", "Books.close"),
    );
    assert.deepEqual(
      result.map((tool) => tool.name),
      ["Books.close", "Books.close_2", "Books.close_3"],
    );
    assert.deepEqual(
      problems.map((problem) => [problem.requested, problem.assigned]),
      [
        ["Books.close", "Books.close_2"],
        ["Books.close", "Books.close_3"],
      ],
    );
  });

  it("does not hand out a suffixed name that another tool already has", () => {
    const { tools: result } = assignToolNames(
      tools("a", "a_2", "a"),
    );
    assert.deepEqual(
      result.map((tool) => tool.name),
      ["a", "a_2", "a_3"],
    );
  });

  it("cuts names to 128 characters, also when a suffix is needed", () => {
    const long = "x".repeat(200);
    const { tools: result, problems } = assignToolNames(tools(long, long));
    assert.equal(result[0].name.length, 128);
    assert.equal(result[1].name.length, 128);
    assert.notEqual(result[0].name, result[1].name);
    assert.ok(result[1].name.endsWith("_2"));
    assert.deepEqual(
      problems.map((problem) => problem.reason),
      ["tooLong", "duplicate"],
    );
  });

  it("keeps all other properties of a renamed tool", () => {
    const { tools: result } = assignToolNames([
      { name: "a b", description: "kept" },
    ]);
    assert.deepEqual(result[0], { name: "a_b", description: "kept" });
  });
});
