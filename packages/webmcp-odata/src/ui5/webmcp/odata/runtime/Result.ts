import Messaging from "sap/ui/core/Messaging";
import { limitResult } from "./Limit";
import {
  errorDetails,
  reasonOf,
  type ErrorDetail,
  type MessageInfo,
  type ModelError,
} from "./Reasons";

export interface ToolMessage {
  type: string;
  text: string;
  target?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  /** Query results: total number of matching entries, if the service reported it */
  count?: number;
  /** Query results: more entries follow after this page */
  hasMore?: boolean;
  /** The list was cut to fit `maxResultChars`; `returned` rows are left, ask for the rest with `skip` */
  truncated?: boolean;
  returned?: number;
  key?: Record<string, unknown>;
  /** ETag of the entry; pass it back to `update` or `delete` to refuse the change if someone else changed the entry meanwhile */
  etag?: string;
  /** The data changed, but these screens were not refreshed because the user has unsaved edits there */
  uiNotRefreshed?: string[];
  /** Machine readable reason for failures, e.g. "draftExists" or "precondition" */
  reason?: string;
  error?: string;
  /** Field level problems the service reported, e.g. which property failed validation */
  details?: ErrorDetail[];
  messages: ToolMessage[];
}

interface UI5Message {
  getType(): string;
  getMessage(): string;
  getTargets(): string[];
  getTechnicalDetails?(): {
    httpStatus?: number;
    originalMessage?: MessageInfo["original"];
  } | undefined;
}

function allMessageObjects(): UI5Message[] {
  return (Messaging.getMessageModel().getData() ?? []) as UI5Message[];
}

/** Messages that existed when the current tool call started; they are not news to the agent */
let baseline = new Set<UI5Message>();

/** Call at the start of every tool call, so results only carry messages that came up during it */
export function startCall(): void {
  baseline = new Set(allMessageObjects());
}

/**
 * UI5 messages (backend warnings and errors) as plain objects
 *
 * @param all include messages that existed before the current call
 */
export function currentMessages(all = false): ToolMessage[] {
  const messages = allMessageObjects().filter(
    (message) => all || !baseline.has(message),
  );
  return messages.map((message) => ({
    type: message.getType(),
    text: message.getMessage(),
    target: message.getTargets()[0],
  }));
}

/**
 * The error messages that came up during the current call, with what UI5 knows about the
 * failed request. For writes that UI5 reports through messages only (see `errorFromMessages`).
 */
export function newErrorMessages(): MessageInfo[] {
  return allMessageObjects()
    .filter((message) => !baseline.has(message) && message.getType() === "Error")
    .map((message) => {
      const technical = message.getTechnicalDetails?.();
      return {
        text: message.getMessage(),
        httpStatus: technical?.httpStatus,
        original: technical?.originalMessage,
      };
    });
}

export function success(
  data?: unknown,
  extra: Partial<ToolResult> = {},
): ToolResult {
  return { ok: true, data, messages: currentMessages(), ...extra };
}

/**
 * Turns an exception from the OData model into a result the agent can act on.
 * UI5 attaches the HTTP status to `error.status`.
 */
export function failure(error: unknown, reason?: string): ToolResult {
  const mapped = reasonOf(error, reason);
  const message = (error as ModelError | undefined)?.message ?? String(error);
  const details = errorDetails(error);
  return {
    ok: false,
    reason: mapped,
    error:
      mapped === "precondition"
        ? `The entry was changed by someone else after it was read, nothing was saved. Read it again and retry. (${message})`
        : message,
    ...(details.length ? { details } : {}),
    messages: currentMessages(),
  };
}

let maxResultChars = 0;

/** Called once at registration; results larger than this are cut, see `limitResult` */
export function configureResults(options: { maxResultChars: number }): void {
  maxResultChars = options.maxResultChars;
}

/** WebMCP's executeTool resolves with a string, so results are serialized */
export function serialize(result: ToolResult): string {
  return JSON.stringify(limitResult(result, maxResultChars));
}
