# ui5-webmcp-odata

Library that reads an OData V4 service's `$metadata` through the UI5 `ODataMetaModel` and registers WebMCP tools (`document.modelContext.registerTool`) for its entity sets and operations. Execution goes through `sap/ui/model/odata/v4/ODataModel`, so the UI stays in sync.

## Layout
- `packages/webmcp-odata` – the reusable UI5 library (TypeScript), namespace `ui5.webmcp.odata`
- `sample/` – CAP backend; `sample/app/books` – Fiori elements app using the library

## Documentation lookup (MCP servers, see `.mcp.json`)
Look APIs up before using them instead of relying on memory:
- `ui5` server: `get_api_reference` for ODataModel, ODataListBinding, ODataContextBinding, ODataMetaModel, ODataUtils; `get_guidelines`; `run_ui5_linter` on the library after changes.
- `cds` server: `search_docs` for draft handling (bypass, locks), ETags, restrictions annotations; `search_model` to inspect the compiled sample model.
- `fiori` server: Fiori elements app generation/configuration.

## Conventions
- OData V4 only. Tool names are `<EntitySet>.<operation>` (ASCII alnum, `_`, `-`, `.`, max 128 chars).
- Tool input schemas must be an object at the top level (no top-level arrays).
- Draft-enabled entities are accessed as active data (CAP draft bypass); never create/edit drafts. Update/delete/actions must go through `DraftGuard` first (for a draft node, against its root).
- Draft nodes (`Chapters`) get no create/update/delete tools: CAP rejects direct writes (422). Children are changed through the root's deep update, always with `ODataModel` relative bindings. No raw `fetch` anywhere.
- Deep update follows CAP: a composition array is the full new set, missing children are deleted (after confirmation), a composition left out is untouched. One group/batch per call (`nextGroupId()`), so it is atomic.
- Respect metadata: Capabilities restrictions, `Core.Computed`, `Core.Immutable`, `Core.OperationAvailable`, `Common.SideEffects`.
- Every decision is a pure module in `metadata/` or `runtime/` (no UI5 imports) with a node test; the UI5 handlers in `tools/` stay thin. `tsx --test` cannot load UI5.
- User-facing texts (dialogs, toasts) go through `text("key")` from `runtime/I18n.ts`. Add the key to `i18n/i18n.properties`, `i18n/i18n_de.properties` and `runtime/DefaultTexts.ts` (a test checks they agree). Text for the agent stays English.
- UI5 build pitfalls: no inline `export { x, type T }` (breaks the component at runtime), and tool modules must not import each other in a cycle.
- After changes: `npm run typecheck`, `npm test`, `npm run lint:ui5 --workspace=packages/webmcp-odata`, and a browser check against the sample (see README, Development).
