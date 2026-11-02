/**
 * English texts, used when `i18n/i18n.properties` cannot be loaded (for example when a
 * dev server only serves the transpiled code of the library). A test keeps them identical
 * to the English bundle, which is the source for translations.
 */
export const DEFAULT_TEXTS: Record<string, string> = {
  confirmTitle: "Confirm action requested by AI agent",
  confirmCreate: "Create a {0}?",
  confirmUpdate: "Update {0}?",
  confirmDelete: "Delete {0} {1}?",
  confirmDeleteChildren: "Update of {0} deletes child entries ({1}). Continue?",
  confirmMove: "Move {0} {1} to {2}?",
  moveTopLevel: "the top level",
  confirmRun: "Run {0}?",
  confirmRunOn: "Run {0} on {1}?",
  confirmDiscard: "Discard all unsaved changes?",
  confirmBatch: "{0}: {1}. Continue?",
  batchCreate: "create {0}",
  batchUpdate: "change {0}",
  batchDelete: "delete {0}",
  toastCreated: "{0} created",
  toastUpdated: "{0} updated",
  toastDeleted: "{0} deleted",
  toastMoved: "{0} moved",
  toastExecuted: "{0} executed",
  toastBatchSaved: "{0}: {1} change(s) saved",
};

/** `{0}`, `{1}` ... are replaced by the arguments, like in a resource bundle */
export function formatText(pattern: string, args: unknown[]): string {
  return pattern.replace(/\{(\d+)\}/g, (match, index: string) =>
    index in args ? String(args[Number(index)]) : match,
  );
}
