import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  describeService,
  signature,
} from "../src/ui5/webmcp/odata/metadata/ServiceDescription";
import {
  introspect,
  type ServiceDescriptor,
} from "../src/ui5/webmcp/odata/metadata/ServiceIntrospector";
import { metadata } from "./fixtures/metadata";

const fakeModel = {
  getMetaModel: () => ({ requestData: async () => metadata }),
} as never;

const none = { confirmWrites: false, confirmDestructive: false, confirmActions: false };

describe("service description", () => {
  let service: ServiceDescriptor;
  before(async () => {
    service = await introspect(fakeModel);
  });

  it("lists aggregation of the sets that announce it, and nothing for the others", () => {
    const { entitySets } = describeService(service, none);
    const archived = entitySets.find((set) => set.name === "ArchivedBooks");
    assert.deepEqual(archived && "aggregation" in archived ? archived.aggregation?.groupable : undefined, ["status"]);
    assert.ok(!("aggregation" in entitySets.find((set) => set.name === "Books")!));
  });

  it("lists hierarchies with the parent key", () => {
    const withHierarchy = {
      ...service,
      entitySets: service.entitySets.map((set) =>
        set.name === "Authors"
          ? {
              ...set,
              hierarchies: [
                { qualifier: "AuthorsHierarchy", nodeProperty: "ID", parentNavigation: "parent", parentKey: "parent_ID", columns: {} },
              ],
            }
          : set,
      ),
    };
    const authors = describeService(withHierarchy, none).entitySets.find((set) => set.name === "Authors");
    assert.deepEqual(authors && "hierarchies" in authors ? authors.hierarchies : undefined, [
      { qualifier: "AuthorsHierarchy", nodeProperty: "ID", parent: "parent_ID" },
    ]);
  });

  it("says which tools ask the user first", () => {
    const confirmation = { confirmWrites: true, confirmDestructive: true, confirmActions: ["addStock"] };
    const books = describeService(service, confirmation).entitySets.find((set) => set.name === "Books");
    assert.deepEqual(books && "asksUserBefore" in books ? books.asksUserBefore : undefined, [
      "create",
      "update",
      "batch",
      "move",
      "delete",
    ]);
    const asking = books?.operations.filter((op) => op.endsWith("[asks the user]")) ?? [];
    assert.equal(asking.length, 1);
    assert.match(asking[0], /addStock/);
    const plain = describeService(service, none).entitySets.find((set) => set.name === "Books");
    assert.ok(plain && !("asksUserBefore" in plain));
  });

  it("marks operations bound to a collection", () => {
    const operation = service.operations.find((op) => op.boundToCollection);
    assert.ok(operation);
    assert.match(signature(operation), /on the whole collection/);
  });

  it("lists singletons, and one name narrows to it", () => {
    const all = describeService(service, none);
    assert.ok(all.singletons.length > 0);
    const only = describeService(service, none, all.singletons[0].name);
    assert.deepEqual(only.entitySets, []);
    assert.equal(only.singletons.length, 1);
  });
});
