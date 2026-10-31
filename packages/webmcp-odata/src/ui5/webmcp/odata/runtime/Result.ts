import Messaging from "sap/ui/core/Messaging";

export interface ToolMessage {
  type: string;
  text: string;
  target?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  key?: Record<string, unknown>;
  /** Machine readable reason for failures, e.g. "draftExists" or "precondition" */
  reason?: string;
  error?: string;
  messages: ToolMessage[];
}

interface UI5Message {
  getType(): string;
  getMessage(): string;
  getTargets(): string[];
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
  const err = error as {
    message?: string;
    status?: number;
    error?: { code?: string };
  };
  // CAP: 409 DRAFT_ALREADY_EXISTS (change), 403 DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS (delete)
  const isDraftConflict =
    /^DRAFT_.*EXISTS/.test(err.error?.code ?? "") ||
    /draft.*exists/i.test(err.message ?? "");
  const mapped =
    reason ??
    // The backend's own draft protection: a draft exists for the active entity we tried to change
    (isDraftConflict
      ? "draftExists"
      : err.status === 412
      ? "precondition"
      : err.status === 409
        ? "conflict"
        : err.status === 404
          ? "notFound"
          : err.status === 403
            ? "forbidden"
            : "error");
  const message = err.message ?? String(error);
  return {
    ok: false,
    reason: mapped,
    error:
      mapped === "precondition"
        ? `The entry was changed by someone else after it was read, nothing was saved. Read it again and retry. (${message})`
        : message,
    messages: currentMessages(),
  };
}

/** WebMCP's executeTool resolves with a string, so results are serialized */
export function serialize(result: ToolResult): string {
  return JSON.stringify(result);
}
