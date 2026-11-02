import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { throwIfAborted } from "../src/ui5/webmcp/odata/runtime/Abort";
import {
  errorDetails,
  errorFromMessages,
  reasonOf,
} from "../src/ui5/webmcp/odata/runtime/Reasons";

describe("errorFromMessages", () => {
  it("turns a rejected create into an error the reason mapping understands", () => {
    const error = errorFromMessages([
      {
        text: "Provide the missing value.",
        httpStatus: 400,
        original: { code: "ASSERT_MANDATORY", target: "name" },
      },
    ]);
    assert.equal(error.message, "Provide the missing value.");
    assert.equal(reasonOf(error), "validation");
    assert.deepEqual(errorDetails(error), [
      { message: "Provide the missing value.", target: "name" },
    ]);
  });

  it("lists every message of a request with several problems", () => {
    const error = errorFromMessages([
      { text: "Required", httpStatus: 400, original: { target: "title" } },
      { text: "Too long", httpStatus: 400, original: { target: "descr" } },
    ]);
    assert.equal(error.message, "Required; Too long");
    assert.deepEqual(errorDetails(error), [
      { message: "Required", target: "title" },
      { message: "Too long", target: "descr" },
    ]);
  });

  it("keeps the status of the service, e.g. forbidden", () => {
    assert.equal(
      reasonOf(errorFromMessages([{ text: "Not allowed", httpStatus: 403 }])),
      "forbidden",
    );
  });

  it("still gives an error if UI5 reported nothing", () => {
    const error = errorFromMessages([]);
    assert.equal(error.message, "The service rejected the request");
    assert.equal(reasonOf(error), "error");
    assert.deepEqual(errorDetails(error), []);
  });
});

describe("reasonOf", () => {
  it("maps HTTP statuses", () => {
    const reason = (status: number) => reasonOf({ status });
    assert.equal(reason(400), "validation");
    assert.equal(reason(401), "unauthenticated");
    assert.equal(reason(403), "forbidden");
    assert.equal(reason(404), "notFound");
    assert.equal(reason(409), "conflict");
    assert.equal(reason(412), "precondition");
    assert.equal(reason(422), "error");
    assert.equal(reason(500), "error");
  });

  it("recognises CAP's draft conflicts before the status", () => {
    assert.equal(
      reasonOf({ status: 409, error: { code: "DRAFT_ALREADY_EXISTS" } }),
      "draftExists",
    );
    assert.equal(
      reasonOf({
        status: 403,
        error: { code: "DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS" },
      }),
      "draftExists",
    );
    assert.equal(reasonOf(new Error("A draft already exists")), "draftExists");
  });

  it("reports a cancelled call as aborted", () => {
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => throwIfAborted(controller.signal), (error: Error) => {
      assert.equal(reasonOf(error), "aborted");
      return true;
    });
    assert.doesNotThrow(() => throwIfAborted(new AbortController().signal));
    assert.doesNotThrow(() => throwIfAborted(undefined));
  });

  it("lets an explicit reason win", () => {
    assert.equal(reasonOf({ status: 412 }, "noChanges"), "noChanges");
  });

  it("copes with things that are not model errors", () => {
    assert.equal(reasonOf(undefined), "error");
    assert.equal(reasonOf("boom"), "error");
  });
});

describe("errorDetails", () => {
  it("lists the details of a validation error with their targets", () => {
    assert.deepEqual(
      errorDetails({
        status: 400,
        error: {
          message: "Multiple errors occurred",
          details: [
            { message: "Value is required", target: "title" },
            { message: "Too long", target: "descr" },
            { code: "x" },
          ],
        },
      }),
      [
        { message: "Value is required", target: "title" },
        { message: "Too long", target: "descr" },
      ],
    );
  });

  it("falls back to the target of a single error", () => {
    assert.deepEqual(
      errorDetails({ error: { message: "Invalid value", target: "stock" } }),
      [{ message: "Invalid value", target: "stock" }],
    );
  });

  it("returns nothing if the service named no field", () => {
    assert.deepEqual(errorDetails({ error: { message: "boom" } }), []);
    assert.deepEqual(errorDetails(new Error("x")), []);
  });
});
