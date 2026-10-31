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
- Draft-enabled entities are accessed as active data (CAP draft bypass); never create/edit drafts. Update/delete must go through `DraftGuard` first.
- Respect metadata: Capabilities restrictions, `Core.Computed`, `Core.Immutable`.
