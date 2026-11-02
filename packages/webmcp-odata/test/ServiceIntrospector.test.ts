import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  introspect,
  type EntitySetDescriptor,
  type ServiceDescriptor,
} from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";
import { metadata } from "./fixtures/metadata";

// Only what the introspector touches: model.getMetaModel().requestData()
const fakeModel = {
  getMetaModel: () => ({ requestData: async () => metadata }),
} as never;

describe("introspect", () => {
  let service: ServiceDescriptor;
  const set = (name: string): EntitySetDescriptor =>
    service.entitySets.find((candidate) => candidate.name === name)!;

  before(async () => {
    service = await introspect(fakeModel);
  });

  it("finds all entity sets of the container", () => {
    assert.deepEqual(
      service.entitySets.map((candidate) => candidate.name),
      ["Books", "Books_texts", "Authors", "Orders", "ArchivedBooks"],
    );
  });

  describe("capabilities", () => {
    it("allows everything by default", () => {
      const books = set("Books");
      assert.ok(books.readable && books.insertable && books.updatable && books.deletable);
      assert.ok(books.searchable);
    });

    it("applies restriction annotations", () => {
      const orders = set("Orders");
      assert.equal(orders.readable, false);
      assert.equal(orders.updatable, false);
      assert.equal(orders.deletable, false);
      assert.equal(orders.insertable, true);
    });

    it("reads search and filter restrictions", () => {
      const authors = set("Authors");
      assert.equal(authors.searchable, false);
      assert.deepEqual(authors.nonFilterable, ["createdAt"]);
    });

    it("detects ETag support", () => {
      assert.equal(set("Books").etag, true);
      assert.equal(set("Authors").etag, false);
    });
  });

  describe("properties", () => {
    const property = (setName: string, name: string) =>
      set(setName).properties.find((candidate) => candidate.name === name)!;

    it("defaults to Edm.String and nullable", () => {
      const title = property("Books", "title");
      assert.equal(title.edmType, "Edm.String");
      assert.equal(title.nullable, true);
      assert.equal(title.maxLength, 111);
    });

    it("flags keys and non-nullable properties", () => {
      assert.ok(property("Books", "ID").isKey);
      assert.equal(property("Books", "ID").nullable, false);
      assert.equal(property("Authors", "name").nullable, false);
      assert.deepEqual(set("Books").keys, ["ID", "IsActiveEntity"]);
    });

    it("reads computed, generated-if-omitted and immutable terms", () => {
      assert.ok(property("Books", "modifiedAt").computed);
      assert.ok(property("Books", "ID").computedDefault);
      assert.equal(property("Books", "ID").computed, false);
      assert.ok(property("Authors", "createdAt").immutable);
    });

    it("reads labels, descriptions and value lists", () => {
      assert.equal(property("Books", "title").label, "Title");
      assert.equal(property("Books", "status").valueListSet, "Statuses");
      assert.equal(set("Books").description, "A book in the catalog");
    });

    it("lists enum members", () => {
      assert.deepEqual(property("Books", "status").enumValues, ["Open", "Closed"]);
    });

    it("recognises collection-valued properties", () => {
      assert.equal(property("Authors", "tags").isCollection, true);
      assert.equal(property("Authors", "name").isCollection, false);
    });

    it("resolves type definitions to their underlying type and facets", () => {
      const rating = property("Authors", "rating");
      assert.equal(rating.edmType, "Edm.Decimal");
      assert.equal(rating.precision, 3);
      assert.equal(rating.scale, 1);
    });

    it("describes complex types, including nested ones", () => {
      const address = property("Authors", "address");
      assert.deepEqual(
        address.complexProperties?.map((nested) => nested.name),
        ["street", "country"],
      );
      assert.equal(address.complexProperties?.[0].nullable, false);
      const country = address.complexProperties?.[1];
      assert.equal(country?.complexProperties?.[0].maxLength, 2);
    });

    it("flags streams as unsupported for input", () => {
      assert.equal(property("Authors", "photo").unsupported, true);
      assert.equal(property("Authors", "name").unsupported, false);
    });
  });

  describe("draft", () => {
    it("recognises draft-enabled roots", () => {
      assert.equal(set("Books").draft, true);
      assert.equal(set("Books").draftRoot, true);
    });

    it("treats other sets as non-draft", () => {
      assert.equal(set("Authors").draft, false);
      assert.equal(set("Authors").draftRoot, false);
    });
  });

  describe("compositions", () => {
    it("finds owned children and the foreign key back to the parent", () => {
      const [chapters, ...others] = set("Books").compositions;
      assert.equal(chapters.name, "chapters");
      assert.equal(chapters.isCollection, true);
      assert.deepEqual(chapters.foreignKeys, ["book_ID"]);
      assert.ok(chapters.properties.some((prop) => prop.name === "title"));
      assert.deepEqual(others, [], "texts must not count as a composition to fill");
    });

    it("does not treat plain associations as compositions", () => {
      const author = set("Books").navigationProperties.find(
        (nav) => nav.name === "author",
      )!;
      assert.equal(author.composition, false);
    });
  });

  describe("operations", () => {
    const operation = (name: string) =>
      service.operations.find((candidate) => candidate.name === name);

    it("finds unbound actions and functions", () => {
      assert.equal(operation("emojifyBooks")?.kind, "action");
      assert.equal(operation("emojifyBooks")?.entitySet, undefined);
      const topBooks = operation("topBooks")!;
      assert.equal(topBooks.kind, "function");
      assert.equal(topBooks.returnsCollection, true);
      assert.deepEqual(
        topBooks.parameters.map((parameter) => parameter.name),
        ["count"],
      );
    });

    it("binds operations to their entity set without the binding parameter", () => {
      const addStock = operation("addStock")!;
      assert.equal(addStock.entitySet, "Books");
      assert.equal(addStock.qualifiedName, "CatalogService.addStock");
      assert.deepEqual(
        addStock.parameters.map((parameter) => [parameter.name, parameter.nullable]),
        [["quantity", false]],
      );
    });

    it("reads descriptions for unbound actions, bound actions and functions", () => {
      assert.equal(operation("emojifyBooks")?.description, "Adds emoji to titles");
      assert.equal(operation("emojifyBooks")?.label, "Emojify");
      assert.equal(operation("addStock")?.description, "Increases the stock");
      assert.equal(operation("topBooks")?.description, "Books with the most stock");
    });

    const boundTo = (name: string, setName: string) =>
      service.operations.find(
        (candidate) => candidate.name === name && candidate.entitySet === setName,
      );

    it("keeps overloads of one name apart, each with its own parameters", () => {
      assert.deepEqual(
        boundTo("addStock", "Books")?.parameters.map((parameter) => parameter.name),
        ["quantity"],
      );
      assert.deepEqual(
        boundTo("addStock", "Authors")?.parameters.map((parameter) => parameter.name),
        ["amount", "reason"],
      );
    });

    it("binds an operation to every entity set of the bound type", () => {
      assert.ok(boundTo("addStock", "Books"));
      assert.ok(boundTo("addStock", "ArchivedBooks"));
      assert.equal(boundTo("addStock", "Orders"), undefined);
    });

    it("keeps operations bound to a collection and marks them", () => {
      const importBooks = boundTo("importBooks", "Books")!;
      assert.equal(importBooks.boundToCollection, true);
      assert.deepEqual(
        importBooks.parameters.map((parameter) => parameter.name),
        ["source"],
      );
      assert.equal(boundTo("addStock", "Books")?.boundToCollection, false);
      assert.equal(operation("emojifyBooks")?.boundToCollection, undefined);
    });

    it("does not expose draft actions", () => {
      assert.equal(operation("draftEdit"), undefined);
    });
  });
});

describe("introspect: metadata awareness", () => {
  let service: ServiceDescriptor;
  const set = (name: string): EntitySetDescriptor =>
    service.entitySets.find((candidate) => candidate.name === name)!;

  before(async () => {
    service = await introspect(fakeModel);
  });

  it("reads field control, validation and text of properties", () => {
    const property = (name: string) =>
      set("Books").properties.find((candidate) => candidate.name === name)!;
    assert.equal(property("title").fieldControl, "mandatory");
    assert.equal(property("stock").minimum, 0);
    assert.equal(property("stock").maximum, 9999);
    assert.equal(property("stock").textPath, "title");
  });

  it("reads aggregation support and expand restrictions per set", () => {
    assert.equal(set("Books").aggregation, undefined);
    assert.deepEqual(set("ArchivedBooks").aggregation?.groupable, ["status"]);
    assert.equal(set("ArchivedBooks").expandable, false);
    assert.equal(set("Books").expandable, true);
  });

  it("finds singletons without listing them as entity sets", () => {
    assert.deepEqual(
      service.singletons.map((singleton) => singleton.name),
      ["Settings"],
    );
    assert.ok(service.singletons[0].updatable);
    assert.ok(service.singletons[0].properties.some((prop) => prop.name === "theme"));
  });

  it("reads availability and side effects of operations", () => {
    const addStock = service.operations.find((op) => op.name === "addStock")!;
    assert.deepEqual(addStock.available, { path: "canAddStock" });
    assert.deepEqual(addStock.sideEffects, { entities: [], properties: ["stock"] });
  });

  it("does not mark types without IsActiveEntity as draft nodes", () => {
    assert.equal(set("Books").draftNode, false);
    assert.equal(set("Authors").draftNode, false);
  });
});

describe("introspect: draft root and node detection", () => {
  const withAnnotations = async (
    extra: Record<string, unknown>,
    chaptersDraft: boolean,
  ) => {
    const model = structuredClone(metadata) as Record<string, any>;
    model["CatalogService.EntityContainer"].Chapters = {
      $kind: "EntitySet",
      $Type: "CatalogService.Chapters",
    };
    if (chaptersDraft) {
      // what CAP generates: a node also has IsActiveEntity and DraftAdministrativeData
      model["CatalogService.Chapters"].IsActiveEntity = {
        $kind: "Property",
        $Type: "Edm.Boolean",
        $Nullable: false,
      };
      model["CatalogService.Chapters"].DraftAdministrativeData = {
        $kind: "NavigationProperty",
        $Type: "CatalogService.DraftAdministrativeData",
      };
    }
    Object.assign(model.$Annotations, extra);
    return introspect({
      getMetaModel: () => ({ requestData: async () => model }),
    } as never);
  };

  it("uses Common.DraftNode over the DraftAdministrativeData navigation", async () => {
    const service = await withAnnotations(
      {
        "CatalogService.EntityContainer/Chapters": {
          "@com.sap.vocabularies.Common.v1.DraftNode": {},
        },
      },
      true,
    );
    const chapters = service.entitySets.find((set) => set.name === "Chapters")!;
    assert.equal(chapters.draftRoot, false);
    assert.equal(chapters.draftNode, true);
    const books = service.entitySets.find((set) => set.name === "Books")!;
    assert.equal(books.draftRoot, true);
    assert.equal(books.draftNode, false);
  });

  it("falls back to the navigation property if nothing is annotated", async () => {
    const service = await withAnnotations({}, true);
    const chapters = service.entitySets.find((set) => set.name === "Chapters")!;
    assert.equal(chapters.draftRoot, true);
    assert.equal(chapters.draftNode, false);
  });
});
