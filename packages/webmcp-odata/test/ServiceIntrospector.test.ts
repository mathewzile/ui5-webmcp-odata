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
      ["Books", "Books_texts", "Authors", "Orders"],
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

    it("does not expose draft actions", () => {
      assert.equal(operation("draftEdit"), undefined);
    });
  });
});
