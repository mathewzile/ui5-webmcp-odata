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
 * @param entitySet only refresh bindings for this entity set; all bindings if omitted
 * @returns paths of the bindings that were refreshed
 */
export function refreshBindings(
  model: ODataModel,
  entitySet?: string,
): string[] {
  const refreshed: string[] = [];
  for (const binding of model.getAllBindings()) {
    const path = binding.getPath();
    // Operation bindings (`/action(...)`) cannot be refreshed
    if (!path || !path.startsWith("/") || path.includes("(...)")) {
      continue;
    }
    if (entitySet && !matchesSet(path, entitySet)) {
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
        continue;
      }
      refreshable.refresh();
      refreshed.push(path);
    } catch (error) {
      // e.g. kept-alive or otherwise unsupported bindings; the next user action refreshes them
      Log.debug(`Cannot refresh ${path}`, String(error), LOG_COMPONENT);
    }
  }
  return refreshed;
}
