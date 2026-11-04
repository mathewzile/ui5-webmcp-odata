import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readAggregation,
  readFieldControl,
  readHierarchies,
  readOperationAvailable,
  readSetCapabilities,
  readSideEffects,
  readTextPath,
  readValidation,
} from "../src/ui5/webmcp/odata/metadata/Capabilities";

const COMMON = "@com.sap.vocabularies.Common.v1";
const CAPS = "@Org.OData.Capabilities.V1";

describe("set capabilities beyond CRUD", () => {
  it("reads the property lists of insert and update restrictions", () => {
    const capabilities = readSetCapabilities(
      {
        [`${CAPS}.InsertRestrictions`]: {
          NonInsertableProperties: [{ $PropertyPath: "status" }],
          RequiredProperties: [{ $PropertyPath: "title" }],
        },
        [`${CAPS}.UpdateRestrictions`]: {
          NonUpdatableProperties: [{ $PropertyPath: "author_ID" }],
        },
      },
      {},
    );
    assert.deepEqual(capabilities.nonInsertable, ["status"]);
    assert.deepEqual(capabilities.requiredOnInsert, ["title"]);
    assert.deepEqual(capabilities.nonUpdatable, ["author_ID"]);
  });

  it("reads expand, count and top support, all allowed by default", () => {
    const defaults = readSetCapabilities({}, {});
    assert.equal(defaults.expandable, true);
    assert.equal(defaults.countable, true);
    assert.equal(defaults.pageable, true);
    assert.deepEqual(defaults.nonExpandable, []);

    const restricted = readSetCapabilities(
      {
        [`${CAPS}.ExpandRestrictions`]: {
          Expandable: false,
          NonExpandableProperties: [{ $NavigationPropertyPath: "texts" }],
        },
        [`${CAPS}.CountRestrictions`]: { Countable: false },
        [`${CAPS}.TopSupported`]: false,
      },
      {},
    );
    assert.equal(restricted.expandable, false);
    assert.equal(restricted.countable, false);
    assert.equal(restricted.pageable, false);
  });
});

describe("readFieldControl", () => {
  const control = (member: string) =>
    readFieldControl({
      [`${COMMON}.FieldControl`]: { $EnumMember: `${COMMON}.FieldControlType/${member}` },
    });

  it("maps the static values", () => {
    assert.equal(control("Mandatory"), "mandatory");
    assert.equal(control("Optional"), "optional");
    assert.equal(control("ReadOnly"), "readOnly");
    assert.equal(control("Inapplicable"), "inapplicable");
    assert.equal(control("Hidden"), "inapplicable");
  });

  it("ignores a control that depends on the data", () => {
    assert.equal(
      readFieldControl({ [`${COMMON}.FieldControl`]: { $Path: "fieldControl" } }),
      undefined,
    );
    assert.equal(readFieldControl({}), undefined);
  });
});

describe("readTextPath", () => {
  it("reads the path of the text property", () => {
    assert.equal(readTextPath({ [`${COMMON}.Text`]: { $Path: "name" } }), "name");
    assert.equal(readTextPath({}), undefined);
  });
});

describe("readValidation", () => {
  it("reads bounds and allowed values", () => {
    assert.deepEqual(
      readValidation({
        "@Org.OData.Validation.V1.Minimum": 0,
        "@Org.OData.Validation.V1.Maximum": 100,
        "@Org.OData.Validation.V1.AllowedValues": [{ Value: "A" }, { Value: "B" }, {}],
      }),
      { minimum: 0, maximum: 100, allowedValues: ["A", "B"] },
    );
  });

  it("is empty without annotations", () => {
    assert.deepEqual(readValidation({}), {
      minimum: undefined,
      maximum: undefined,
      allowedValues: undefined,
    });
  });
});

describe("readAggregation", () => {
  it("is undefined if the service does not announce $apply support", () => {
    assert.equal(readAggregation({}, {}), undefined);
  });

  it("reads transformations, groupable and aggregatable properties", () => {
    const aggregation = readAggregation(
      {
        "@Org.OData.Aggregation.V1.ApplySupported": {
          Transformations: ["aggregate", "groupby", "filter"],
          GroupableProperties: [{ $PropertyPath: "genre_ID" }],
          AggregatableProperties: [
            {
              Property: { $PropertyPath: "stock" },
              SupportedAggregationMethods: ["sum", "average"],
            },
            { Property: { $PropertyPath: "price" } },
          ],
        },
      },
      { "@Org.OData.Aggregation.V1.CustomAggregate#stockTotal": "Edm.Int32" },
    );
    assert.deepEqual(aggregation, {
      transformations: ["aggregate", "groupby", "filter"],
      groupable: ["genre_ID"],
      aggregatable: [
        { property: "stock", methods: ["sum", "average"] },
        { property: "price", methods: undefined },
      ],
      customAggregates: [{ name: "stockTotal", edmType: "Edm.Int32" }],
    });
  });

  it("lists a custom aggregate once if it is annotated on the set and on the type", () => {
    const annotation = { "@Org.OData.Aggregation.V1.CustomAggregate#stockTotal": "Edm.Int32" };
    const aggregation = readAggregation(
      { "@Org.OData.Aggregation.V1.ApplySupported": { Transformations: ["aggregate"] }, ...annotation },
      annotation,
    );
    assert.deepEqual(aggregation?.customAggregates, [{ name: "stockTotal", edmType: "Edm.Int32" }]);
  });

  it("leaves the lists open if the annotation names none", () => {
    const aggregation = readAggregation(
      { "@Org.OData.Aggregation.V1.ApplySupported": { Transformations: ["groupby"] } },
      {},
    );
    assert.equal(aggregation?.groupable, undefined);
    assert.equal(aggregation?.aggregatable, undefined);
  });

  it("also finds the annotation on the type", () => {
    assert.ok(
      readAggregation(
        {},
        { "@Org.OData.Aggregation.V1.ApplySupported": { Transformations: [] } },
      ),
    );
  });
});

describe("readHierarchies", () => {
  const annotations = {
    "@Org.OData.Aggregation.V1.RecursiveHierarchy#GenresHierarchy": {
      NodeProperty: { $PropertyPath: "ID" },
      ParentNavigationProperty: { $NavigationPropertyPath: "parent" },
    },
    "@com.sap.vocabularies.Hierarchy.v1.RecursiveHierarchy#GenresHierarchy": {
      DrillState: { $Path: "DrillState" },
      DistanceFromRoot: { $Path: "DistanceFromRoot" },
    },
  };

  it("reads node, parent and the computed columns per qualifier", () => {
    assert.deepEqual(readHierarchies(annotations), [
      {
        qualifier: "GenresHierarchy",
        nodeProperty: "ID",
        parentNavigation: "parent",
        columns: { DrillState: "DrillState", DistanceFromRoot: "DistanceFromRoot" },
      },
    ]);
  });

  it("skips incomplete declarations and types without any", () => {
    assert.deepEqual(readHierarchies({}), []);
    assert.deepEqual(
      readHierarchies({
        "@Org.OData.Aggregation.V1.RecursiveHierarchy#x": {
          NodeProperty: { $PropertyPath: "ID" },
        },
      }),
      [],
    );
  });
});

describe("readSideEffects", () => {
  it("collects target entities and properties of all qualifiers", () => {
    assert.deepEqual(
      readSideEffects({
        [`${COMMON}.SideEffects`]: {
          TargetEntities: [{ $NavigationPropertyPath: "chapters" }, { $NavigationPropertyPath: "" }],
        },
        [`${COMMON}.SideEffects#more`]: {
          TargetProperties: ["stock", { $PropertyPath: "price" }],
        },
      }),
      { entities: ["chapters", ""], properties: ["stock", "price"] },
    );
  });

  it("is undefined without a side effects annotation", () => {
    assert.equal(readSideEffects({ [`${COMMON}.Label`]: "x" }), undefined);
  });
});

describe("readOperationAvailable", () => {
  it("reads a fixed value or a path", () => {
    const term = "@Org.OData.Core.V1.OperationAvailable";
    assert.equal(readOperationAvailable({ [term]: false }), false);
    assert.equal(readOperationAvailable({ [term]: true }), true);
    assert.deepEqual(readOperationAvailable({ [term]: { $Path: "canClose" } }), {
      path: "canClose",
    });
    assert.equal(readOperationAvailable({}), undefined);
  });
});
