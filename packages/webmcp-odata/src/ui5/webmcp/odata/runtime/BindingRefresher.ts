import Log from "sap/base/Log";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import type ODataListBinding from "sap/ui/model/odata/v4/ODataListBinding";

const LOG_COMPONENT = "ui5.webmcp.odata.BindingRefresher";

function matchesSet(path: string, entitySet: string): boolean {
  const base = `/${entitySet}`;
  return (
    path === base || path.startsWith(`${base}(`) || path.startsWith(`${base}/`)
  );
}

/**
 * Refreshes the model's list and context bindings so the UI reflects changes made by tools.
 * Relative bindings are skipped, they get refreshed with their parent. Bindings with
 * pending user changes are skipped to not discard them.
 *
 * @param entitySet only refresh bindings for this entity set (or these sets); all bindings if omitted
 * @returns paths of the bindings that were refreshed, and of those skipped because the user has unsaved changes there
 */
export function refreshBindings(
  model: ODataModel,
  entitySet?: string | string[],
): RefreshResult {
  const sets = entitySet === undefined ? undefined : [entitySet].flat();
  const refreshed: string[] = [];
  const skipped: string[] = [];
  for (const binding of model.getAllBindings()) {
    const path = binding.getPath();
    // Operation bindings (`/action(...)`) cannot be refreshed
    if (!path || !path.startsWith("/") || path.includes("(...)")) {
      continue;
    }
    if (sets && !sets.some((name) => matchesSet(path, name))) {
      continue;
    }
    if (
      !binding.isA([
        "sap.ui.model.odata.v4.ODataListBinding",
        "sap.ui.model.odata.v4.ODataContextBinding",
      ])
    ) {
      continue;
    }
    const refreshable = binding as ODataListBinding | ODataContextBinding;
    try {
      if (refreshable.hasPendingChanges()) {
        skipped.push(path);
        continue;
      }
      refreshable.refresh();
      refreshed.push(path);
    } catch (error) {
      // e.g. kept-alive or otherwise unsupported bindings; the next user action refreshes them
      Log.debug(`Cannot refresh ${path}`, String(error), LOG_COMPONENT);
    }
  }
  return { refreshed, skipped };
}

export interface RefreshResult {
  refreshed: string[];
  skipped: string[];
}

/**
 * Tells the agent when the data changed but a screen still shows the old state,
 * because the user has unsaved edits there. Nothing is added if all is in sync.
 */
export function staleInfo(result: RefreshResult): { uiNotRefreshed?: string[] } {
  return result.skipped.length ? { uiNotRefreshed: result.skipped } : {};
}
