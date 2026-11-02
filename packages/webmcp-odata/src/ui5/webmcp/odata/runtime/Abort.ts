/**
 * WebMCP hands every tool call an AbortSignal that fires when the agent cancels it.
 * Handlers call this before the step that cannot be taken back (sending a batch, deleting),
 * so a cancelled call changes nothing. It becomes the failure reason `aborted`.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("The call was cancelled");
    error.name = "AbortError";
    throw error;
  }
}
