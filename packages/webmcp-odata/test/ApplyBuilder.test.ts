import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregationRules,
  buildApply,
  type AggregationRules,
} from "../src/ui5/webmcp/odata/metadata/ApplyBuilder";
import type { EntitySetDescriptor } from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";

const rules: AggregationRules = {
  groupable: ["genre_ID", "author_ID"],
  aggregatable: [
    { property: "stock", methods: ["sum", "average"] },
    { property: "price", methods: ["max"] },
  ],
  customAggregates: ["stockTotal"],
  transformations: ["aggregate", "groupby", "filter"],
  draft: true,
};

describe("buildApply", () => {
  it("groups, aggregates and limits draft sets to active data", () => {
    const built = buildApply(
      { groupBy: ["genre_ID"], aggregate: [{ property: "stock", with: "sum", as: "total" }] },
      rules,
    );
    assert.equal(
      built.apply,
      "filter(IsActiveEntity eq true)/groupby((genre_ID),aggregate(stock with sum as total))",
    );
    assert.deepEqual(built.columns, ["genre_ID", "total"]);
    assert.equal(built.orderby, "genre_ID");
  });

  it("puts the user filter after the draft filter", () => {
    const built = buildApply(
      { groupBy: ["author_ID"], filter: "stock gt 5", count: "n" },
      rules,
    );
    assert.equal(
      built.apply,
      "filter(IsActiveEntity eq true)/filter(stock gt 5)/groupby((author_ID),aggregate($count as n))",
    );
  });

  it("aggregates without grouping, on non-draft sets without a draft filter", () => {
    const built = buildApply(
      { aggregate: [{ property: "price", with: "max", as: "top" }] },
      { ...rules, draft: false },
    );
    assert.equal(built.apply, "aggregate(price with max as top)");
    assert.equal(built.orderby, "");
  });

  it("groups without aggregating", () => {
    assert.equal(
      buildApply({ groupBy: ["genre_ID", "author_ID"] }, { ...rules, draft: false }).apply,
      "groupby((genre_ID,author_ID))",
    );
  });

  it("uses custom aggregates without a method", () => {
    assert.equal(
      buildApply(
        { aggregate: [{ property: "stockTotal", with: "sum", as: "t" }] },
        { ...rules, draft: false },
      ).apply,
      "aggregate(stockTotal as t)",
    );
  });

  it("refuses names and methods the service does not allow", () => {
    assert.throws(() => buildApply({ groupBy: ["title"] }, rules), /Cannot group by title/);
    assert.throws(
      () => buildApply({ aggregate: [{ property: "title", with: "sum", as: "x" }] }, rules),
      /Cannot aggregate title/,
    );
    assert.throws(
      () => buildApply({ aggregate: [{ property: "price", with: "sum", as: "x" }] }, rules),
      /Cannot use sum on price/,
    );
  });

  it("refuses bad or repeated aliases", () => {
    const item = (as: string) => ({ property: "stock", with: "sum", as });
    assert.throws(() => buildApply({ aggregate: [item("a b")] }, rules), /Invalid alias/);
    assert.throws(() => buildApply({ aggregate: [item("1x")] }, rules), /Invalid alias/);
    assert.throws(
      () => buildApply({ aggregate: [item("t"), item("t")] }, rules),
      /used twice/,
    );
    assert.throws(
      () => buildApply({ groupBy: ["genre_ID"], aggregate: [item("genre_ID")] }, rules),
      /used twice/,
    );
  });

  it("needs something to do", () => {
    assert.throws(() => buildApply({}, rules), /at least one/);
  });

  it("refuses a filter that could break out of its transformation", () => {
    assert.throws(
      () => buildApply({ groupBy: ["genre_ID"], filter: "stock gt 1)/filter(true" }, rules),
      /unbalanced/,
    );
    // parentheses inside string literals are fine
    assert.ok(buildApply({ groupBy: ["genre_ID"], filter: "contains(title,')')" }, rules));
  });

  it("only sorts by result columns", () => {
    assert.throws(
      () => buildApply({ groupBy: ["genre_ID"], orderby: "title" }, rules),
      /Cannot sort by title/,
    );
    assert.equal(
      buildApply(
        {
          groupBy: ["genre_ID"],
          aggregate: [{ property: "stock", with: "sum", as: "t" }],
          orderby: "t desc",
        },
        rules,
      ).orderby,
      "t desc",
    );
  });

  it("respects the transformations the service lists", () => {
    const limited = { ...rules, transformations: ["groupby"] };
    assert.throws(() => buildApply({ count: "n" }, limited), /does not support aggregate/);
    assert.throws(
      () => buildApply({ groupBy: ["genre_ID"], filter: "stock gt 1" }, limited),
      /does not support filter/,
    );
  });
});

describe("aggregationRules", () => {
  const prop = (name: string, edmType = "Edm.String", extra = {}) => ({
    name,
    edmType,
    nullable: true,
    isKey: false,
    computed: false,
    computedDefault: false,
    immutable: false,
    ...extra,
  });
  const set = (aggregation: EntitySetDescriptor["aggregation"]) =>
    ({
      draft: true,
      aggregation,
      properties: [
        prop("title"),
        prop("stock", "Edm.Int32"),
        prop("IsActiveEntity", "Edm.Boolean"),
        prop("photo", "Edm.Stream", { unsupported: true }),
      ],
    }) as unknown as EntitySetDescriptor;

  it("is undefined without ApplySupported", () => {
    assert.equal(aggregationRules(set(undefined)), undefined);
  });

  it("opens the lists the annotation leaves out", () => {
    const result = aggregationRules(
      set({ transformations: [], customAggregates: [] }),
    )!;
    assert.deepEqual(result.groupable, ["title", "stock"]);
    assert.deepEqual(result.aggregatable.map((entry) => entry.property), ["stock"]);
    assert.ok(result.draft);
  });

  it("keeps the lists the annotation gives", () => {
    const result = aggregationRules(
      set({
        transformations: ["groupby"],
        groupable: ["title"],
        aggregatable: [{ property: "stock", methods: ["max"] }],
        customAggregates: [{ name: "c", edmType: "Edm.Int32" }],
      }),
    )!;
    assert.deepEqual(result.groupable, ["title"]);
    assert.deepEqual(result.aggregatable, [{ property: "stock", methods: ["max"] }]);
    assert.deepEqual(result.customAggregates, ["c"]);
  });
});
