/** Error shape of the UI5 OData V4 model: the HTTP status and the service's error body */
export interface ModelError {
  message?: string;
  status?: number;
  error?: {
    code?: string;
    message?: string;
    target?: string;
    details?: { code?: string; message?: string; target?: string }[];
  };
}

export interface ErrorDetail {
  message: string;
  target?: string;
}

/**
 * Machine readable reason for a failed call, from the HTTP status and the service's
 * error code. An explicit reason from the caller always wins.
 */
export function reasonOf(error: unknown, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if ((error as { name?: string } | undefined)?.name === "AbortError") {
    return "aborted";
  }
  const err = (error ?? {}) as ModelError;
  // CAP: 409 DRAFT_ALREADY_EXISTS (change), 403 DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS (delete).
  // The backend's own draft protection: a draft exists for the active entity we tried to change
  if (
    /^DRAFT_.*EXISTS/.test(err.error?.code ?? "") ||
    /draft.*exists/i.test(err.message ?? "")
  ) {
    return "draftExists";
  }
  switch (err.status) {
    case 400:
      return "validation";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "notFound";
    case 409:
      return "conflict";
    case 412:
      return "precondition";
    default:
      // Includes CAP's 422 DRAFT_MODIFICATION_ONLY_VIA_ROOT: not something the agent fixes by changing its input
      return "error";
  }
}

/** An error message of UI5's message model, reduced to what describes a failed request */
export interface MessageInfo {
  text: string;
  httpStatus?: number;
  /** Error body as the service sent it */
  original?: { code?: string; message?: string; target?: string };
}

/**
 * A rejected create or other write that UI5 only reports through its messages
 * (it retries the request and never rejects). Gives the same shape the model
 * uses for errors it throws, so `reasonOf` and `errorDetails` work on it.
 */
export function errorFromMessages(messages: MessageInfo[]): Error & ModelError {
  const text =
    messages.map((message) => message.text).join("; ") ||
    "The service rejected the request";
  const error: Error & ModelError = new Error(text);
  const first = messages.find((message) => message.httpStatus);
  error.status = first?.httpStatus;
  if (messages.length === 1) {
    error.error = { ...messages[0].original, message: text };
  } else if (messages.length > 1) {
    error.error = {
      ...first?.original,
      message: text,
      details: messages.map((message) => ({
        code: message.original?.code,
        message: message.text,
        target: message.original?.target,
      })),
    };
  }
  return error;
}

/**
 * What the service said went wrong, field by field. Validation errors name the
 * property (`target`), which is what lets the agent fix its input.
 */
export function errorDetails(error: unknown): ErrorDetail[] {
  const body = ((error ?? {}) as ModelError).error;
  const details = (body?.details ?? [])
    .filter((detail) => detail.message)
    .map((detail) => ({ message: detail.message!, target: detail.target }));
  if (details.length) {
    return details;
  }
  return body?.target && body.message
    ? [{ message: body.message, target: body.target }]
    : [];
}
