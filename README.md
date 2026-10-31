# ui5-webmcp-odata

A UI5 library that reads an **OData V4** service's `$metadata` when your app starts and registers
[WebMCP](https://github.com/webmachinelearning/webmcp) tools (`document.modelContext.registerTool`) for its
entity sets and operations, so an AI agent in the browser can read and change the app's data.

Handlers run through the app's own `sap.ui.model.odata.v4.ODataModel`: they use the signed-in user's session and
authorizations, and the lists and object pages on screen are refreshed after changes.

It evolved from a proof of concept with hand-written tools (hierarchy designer). Nothing is hand-written here: add
the library, one line in your `Component`, and tools appear for every entity set and action the metadata exposes.

> WebMCP is an experimental browser API. The library does nothing (and costs nothing) in browsers without
> `document.modelContext`.

**Contents**
[Use it in your app](#use-it-in-your-app) ·
[Options](#options) ·
[Generated tools](#generated-tools) ·
[Draft-enabled entities](#draft-enabled-entities) ·
[How the UI is refreshed](#how-the-ui-is-refreshed) ·
[Security and authorization](#security-and-authorization) ·
[Limitations](#limitations) ·
[Sample app](#sample-app) ·
[Deploy the sample to SAP Build Work Zone](#deploy-the-sample-to-sap-build-work-zone) ·
[Development](#development) ·
[Status](#status)

---

## Use it in your app

Requirements: a UI5 app with an OData V4 model (Fiori elements or freestyle). Developed and tested with
SAPUI5 1.153; the APIs it needs (`Library.init` v2, `ElementRegistry`, V4 model) exist since 1.120, but older
versions are untested.

### 1. Get the library

The library is TypeScript and **not published to npm yet**. Add it the way the sample does, as an npm workspace
or a path/tarball/git dependency of your app:

```json
{ "dependencies": { "ui5-webmcp-odata": "*" } }
```

UI5 tooling picks it up through its `ui5.yaml` (`type: library`, name `ui5.webmcp.odata`). Because the library is
TypeScript, the tooling has to transpile it, even if your own app is JavaScript.

### 2. Configure the UI5 tooling

In your app's `ui5.yaml`, add the transpile task and middleware, and let the middleware transpile dependencies:

```yaml
builder:
  customTasks:
    - name: ui5-tooling-transpile-task
      afterTask: replaceVersion
server:
  customMiddleware:
    - name: ui5-tooling-transpile-middleware
      afterMiddleware: compression
      configuration:
        transpileDependencies: true   # experimental flag of ui5-tooling-transpile
```

and add `ui5-tooling-transpile` to your app's `devDependencies`.

### 3. Declare the library in `manifest.json`

```jsonc
"sap.ui5": {
  "resourceRoots": {
    // where the library is served from, relative to your app's root
    "ui5.webmcp.odata": "./resources/ui5/webmcp/odata/"
  },
  "dependencies": {
    "libs": { "ui5.webmcp.odata": {} }
  },
  "ui5.webmcp": {             // optional, see "Options"
    "maxTop": 25
  }
}
```

During development the UI5 server serves the library at `<app>/resources/ui5/webmcp/odata/`. For deployment it has
to be shipped with your app, see [Deploy](#deploy-the-sample-to-sap-build-work-zone) (the zipper task's
`includeDependencies`).

### 4. Register the tools in your component

The model is read when you call `register`, so call it after `super.init()`.

**TypeScript** (Fiori elements `AppComponent`)

```ts
import BaseComponent from "sap/fe/core/AppComponent";
import ODataWebMCP from "ui5/webmcp/odata/WebMCP";

export default class Component extends BaseComponent {
  private _webMcp: Promise<AbortController | null> | null = null;

  public static metadata = { manifest: "json" };

  public init(): void {
    super.init();
    // default (unnamed) model, options from "sap.ui5" > "ui5.webmcp" in the manifest
    this._webMcp = ODataWebMCP.registerForComponent(this);
  }

  public exit(): void {
    void this._webMcp?.then((controller) => controller?.abort()); // unregisters all tools
    super.exit();
  }
}
```

**JavaScript**

```js
sap.ui.define(["sap/fe/core/AppComponent", "ui5/webmcp/odata/WebMCP"], function (AppComponent, ODataWebMCP) {
  return AppComponent.extend("my.app.Component", {
    metadata: { manifest: "json" },
    init: function () {
      AppComponent.prototype.init.apply(this, arguments);
      this._webMcp = ODataWebMCP.registerForComponent(this);
    },
    exit: function () {
      this._webMcp?.then((controller) => controller?.abort());
      AppComponent.prototype.exit.apply(this, arguments);
    },
  });
});
```

`registerForComponent(component, modelName?)` uses the default model unless you pass a model name. Without a
component, call `ODataWebMCP.register(model, options)` directly. Both return a promise of an `AbortController`
(or `null` if WebMCP is unavailable); `abort()` removes the tools.

Registration needs the metadata, so tools appear shortly after the app has started, not synchronously in `init`.

### 5. Try it

Open the app in a browser that supports WebMCP, with an agent or the WebMCP Inspector extension attached, and ask
for something like "list the books with fewer than 10 in stock" or "add a book called X with two chapters".
Start with the `app.describe_service` tool, which tells the agent what the service offers.

No WebMCP browser at hand? A stand-in that records the registrations is enough to call the handlers:

```js
// paste in the console before registering (or after, then call ODataWebMCP.register yourself)
window.__tools = new Map();
Object.defineProperty(document, "modelContext", { configurable: true, value: {
  registerTool: async (tool) => { window.__tools.set(tool.name, tool); },
}});
// later: JSON.parse(await __tools.get("Books.query").execute({ top: 3 }, { signal: new AbortController().signal }))
```

---

## Options

Pass them in the manifest (`sap.ui5` > `ui5.webmcp`) or to `ODataWebMCP.register(model, options)`.

| Option | Meaning |
|---|---|
| `include` | Only these entity sets get tools. Also the way to get tools for CAP text tables (`Books_texts`), which are skipped by default |
| `exclude` | Entity sets that never get tools |
| `entitySets.<Set>.operations` | Narrow the CRUD tools of one set, e.g. `["query", "get"]`; the metadata restrictions apply on top |
| `entitySets.<Set>.skipOperations` | No tools for actions and functions bound to this set |
| `toolPrefix` | Prefix for every tool name, e.g. `"bookshop."` |
| `maxTop` | Page size limit of query tools (default 50) |
| `confirmDestructive` | Ask the user in the UI before a delete (default `true`) |
| `exposedTo` | Origins allowed to call the tools, passed to `registerTool` |

Every action and function is exposed unless its entity set is excluded. There is no per-operation switch for
unbound operations yet; if one must not be callable by an agent, don't expose it in the service (or protect it
with `@restrict`).

---

## Generated tools

Names are `<EntitySet>.<operation>`; all tools return JSON.

**Per entity set**, only if the metadata allows it:

| Tool | Created unless | Notes |
|---|---|---|
| `.query` | `ReadRestrictions/Readable: false` | `filter`, `select`, `orderby`, `expand`, `search` (if searchable), `top`, `skip` |
| `.get` | `ReadRestrictions/Readable: false` | by key |
| `.create` | `InsertRestrictions/Insertable: false` | also takes compositions as nested data, see below |
| `.update` | `UpdateRestrictions/Updatable: false` | `changes` object plus the key; sent as one batch |
| `.delete` | `DeleteRestrictions/Deletable: false` | asks the user to confirm in the UI |

In CAP, `@readonly` and `@insertonly` produce those restrictions.

**Input schemas follow the metadata.** `Core.Computed` properties (generated fields, `managed` aspect) are not
accepted on create; keys and `Core.Immutable` properties cannot be changed; non-nullable properties are required;
`Core.ComputedDefaultValue` (CAP `cuid` keys) is optional on create, so the server generates the value but the
caller may supply one (needed to wire up parent references in a single request). Edm types map to JSON Schema
(`Int64` and `Decimal` are strings, like in the UI5 V4 model; dates and GUIDs carry a `format`), enums to `enum`,
and `Common.Label`, `Core.Description` and the target of `Common.ValueList` end up in the descriptions.

**Deep create.** `.create` accepts the entity's compositions (`Books.chapters`) as nested arrays/objects and
creates the tree in one request. One level deep. The foreign key back to the parent is filled in by the server, and
properties the child schema does not allow are dropped.

**Actions and functions** become tools too: `<Name>` for unbound and `<EntitySet>.<Name>` for bound ones. Functions
are marked read-only. A `Core.Description` annotation on the operation becomes the tool description, so write one:
it is what tells the agent what the action does.

**App tools**

| Tool | Purpose |
|---|---|
| `app.describe_service` | Entity sets, keys, properties, allowed operations, relations. Agents should call this first |
| `app.refresh` | Re-read data for one entity set or everything |
| `app.get_messages` | Current UI5 messages (server errors and warnings) |
| `app.pending_changes` | Whether the user has unsaved edits |
| `app.reset_changes` | Discard the user's unsaved edits (asks to confirm) |
| `app.get_current_context` | URL hash and the rows selected in tables, for "update the selected items" |
| `app.navigate` | Open an entity set's list or one entry (Fiori elements hash `<Set>(<key>)`) |

**Results** look like `{ ok, data?, key?, reason?, error?, messages[] }`. Failures carry a `reason` the agent can act
on: `draftExists`, `precondition` (changed by someone else, re-read and retry), `conflict`, `notFound`, `forbidden`,
`declined`, `notChangeable`, `noChanges`, `error`. `messages` only contains what came up during that call.

---

## Draft-enabled entities

Tools never create or edit drafts. They read and write the **active** data directly, using CAP's draft bypass
(`cds.fiori.bypass_draft`, on by default); queries only return active entries.

Before an update, a delete, or a bound action on a **draft root**, the library reads `HasDraftEntity` and
`DraftAdministrativeData`. If a draft exists it refuses with `reason: "draftExists"` and says who holds it, because
activating that draft later would silently overwrite the change. The check runs before any confirmation dialog.

CAP enforces the same on the server (checked against the sample), so the library is the friendly layer and the
server the backstop:

| Request on the active entity while a draft exists | Result |
|---|---|
| `PATCH` | `409 DRAFT_ALREADY_EXISTS` |
| `DELETE` | `403 DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS` |
| `PATCH` with a stale `@odata.etag` | `412`, reported as `reason: "precondition"` |

Child nodes of a draft tree can only be changed through their root (`422 DRAFT_MODIFICATION_ONLY_VIA_ROOT`).

---

## How the UI is refreshed

Not with `requestSideEffects`. After a successful create, update, delete or action, `refreshBindings`
(`runtime/BindingRefresher.ts`) goes through the model's bindings and calls `refresh()` on every **absolute list or
context binding** of the affected entity set, i.e. the list report's table and an open object page. That re-reads the
whole collection or entity.

Why not side effects: the tool works on its own detached binding, not on the context behind a table row, so there is
no UI context to target, and a generic library cannot know which properties an action changes. A refresh is simple
and always correct, at the price of an extra read.

What that means for you:

- Bindings with **pending user changes are skipped**, so an agent never discards a user's unsaved edits. Their view
  stays stale until the user saves or cancels.
- **Unbound actions refresh every absolute binding**, because the library cannot tell what they changed.
- **Related entity sets are not refreshed.** Creating a `Chapter` refreshes bindings on `Chapters`, not the open
  `Books` object page that shows them. `app.refresh` (no argument) or a manual reload covers that.
- Annotation-driven **`Common.SideEffects` are not evaluated**; that is a Fiori elements feature for user edits.
- Relative bindings are not refreshed on their own, only together with their parent binding.

A finer approach (finding the table's context for the changed key and calling `requestSideEffects` or
`requestRefresh` on it) is possible and would cut the traffic. It is not implemented.

---

## Security and authorization

- Tools run **in the user's browser session**, with the user's token or cookie. An agent can do what the user can do,
  nothing more. Every request is checked by your backend (XSUAA, `@restrict` and so on) as usual.
- Tools are generated from `$metadata`, which describes the *service*, not the current user. See
  [Limitations](#limitations) for what that means for read-only users.
- Query results are marked `untrustedContentHint`: treat data coming back from the service as untrusted input to
  the agent (prompt injection through data is possible).
- Deleting asks for confirmation in the UI (`confirmDestructive`); **actions and other writes do not**. Anything an
  agent may call is callable without a prompt, so don't expose destructive actions you would not want triggered by
  a prompt.
- `exposedTo` restricts which origins may call the tools.

---

## Limitations

**Platform**
- **OData V4 only**, through `sap.ui.model.odata.v4.ODataModel`. One model per `register` call.
- WebMCP is experimental and browser support is limited. Registration through the browser's native API has **not**
  been verified in this project (handlers were verified with a stand-in, see [Status](#status)).
- Tools are registered on the **document of your app**. If the app runs inside an iframe (SAP Build Work Zone may
  host it that way), whether an agent can see the tools depends on the browser's WebMCP implementation. Not verified.
- Developed and tested with SAPUI5 1.153 and CAP; other OData V4 backends should work but are untested.

**Metadata and generation**
- Metadata is read **once at startup**; a changed service needs a reload.
- `$metadata` is not user specific. A read-only user may still get write tools and see them fail with `403`.
  Hide them with `entitySets.<Set>.operations` if that matters.
- Only static annotations are evaluated (Capabilities restrictions, Core terms, `Common.Label`, `Common.ValueList`
  collection path, `Common.DraftRoot`). `Capabilities.SortRestrictions` are read but not enforced, and dynamic
  restrictions (path expressions) are not.
- The tool count grows with the service: 5 per entity set plus operations. There are no generic tools
  (`entitySet` as a parameter) for services with very many entity sets; use `include` and `exclude`.
- CAP text tables (`*_texts`) get no tools unless included, so translations cannot be edited.
- Complex-typed properties are free-form objects; media streams and `Edm.Stream` are not supported; `Edm.Binary` is
  passed as base64.
- Operation parameters of entity or complex type are free-form objects.

**Behavior**
- `.update` changes properties of one entity; no updates of related entities or collections, no deep update.
- Deep create is one level deep.
- No `$apply` aggregation, no `$batch` of several different calls in a single tool.
- `.query` returns at most `maxTop` rows per call (default 50); the agent has to page with `skip`.
- Draft handling is as described above: active data only, no draft editing, check-then-write (a draft created in
  the instant between the check and the write is caught only by the server).
- Refresh behavior and its gaps: see [How the UI is refreshed](#how-the-ui-is-refreshed).
- `app.get_current_context` finds tables by duck typing (controls with `getSelectedContexts`), and does not report
  field values being edited on an object page.
- `app.navigate` assumes the Fiori elements hash format; freestyle apps with other routes are not supported.
- UI texts (dialogs, toasts, tool descriptions generated by the library) are English only.

**Packaging**
- The library is not published to npm and ships as TypeScript, so consuming apps need `ui5-tooling-transpile`.
- Deployed apps must bundle the library themselves (the sample does it with the zipper task).

---

## Sample app

`sample/` is a CAP bookshop with a Fiori elements list report/object page (`sample/app/books`) that exercises every
branch: a draft-enabled entity with ETag and compositions (`Books`, `Chapters`), plain CRUD (`Authors`), a hierarchy
(`Genres`), read-only (`Currencies`) and insert-only (`Orders`) entities, a bound action (`Books.addStock`), an unbound
action (`emojifyBooks`) and a function (`topBooks`).

```
npm install
npm run watch          # cds watch, opens http://localhost:4004/ui5webmcpodatasamplebooks/index.html
```

It runs with an in-memory SQLite database (reset on every restart) and **mocked authentication**. Sign in with

| User | Password | Roles |
|---|---|---|
| `alice` | `alice` | `Admin`: read, write, run actions |
| `bob` | `bob` | `Viewer`: read, and call `topBooks` |

The restrictions are declared on the entities and operations (`sample/srv/catalog-service.cds`) and apply to the AI
agent exactly as to the user. Note that CAP ignores `@restrict` on the *service* itself; use entity or operation level.
Checked over HTTP: anonymous gets 401, `bob` gets 403 on writes and on `emojifyBooks`, `alice` can do everything.
Because `$metadata` is identical for both users, `bob`'s agent still gets write tools and sees them fail with 403.

---

## Deploy the sample to SAP Build Work Zone

`sample/` is prepared for Cloud Foundry on SAP BTP with XSUAA authentication and SAP Build Work Zone, standard
edition. The files come from `cds add hana,xsuaa,workzone-standard,mta` and were adapted:

| File | What it does |
|---|---|
| `sample/mta.yaml` | Modules (CAP server, HDI deployer, HTML5 app content), services (XSUAA, HANA HDI container, destination, HTML5 repo host), role collections, and the `srv-api` destination |
| `sample/xs-security.json` | Scopes and role templates `Viewer` and `Admin`, derived from `@restrict` |
| `sample/app/books/xs-app.json` | Routes `/odata/*` to the server destination (with the user's token) and everything else to the HTML5 repo |
| `sample/app/books/webapp/manifest.json` | `sap.cloud.service`, the `BooksWebMCP-manage` inbound (the tile), relative data source URI, `resourceRoots` for the library |
| `sample/app/books/ui5.yaml` | Zipper task that packs the app **including the library** into `ui5webmcpodatasamplebooks.zip` |

Production runs on SAP HANA Cloud (`@cap-js/hana`); the SQLite database is for local use only. The `[development]`
mocked users are not used in production, where the `production` profile switches authentication to `xsuaa`.

**Prerequisites** in the BTP subaccount (Cloud Foundry): an SAP HANA Cloud instance mapped to your space, the
service entitlements for XSUAA, Destination, HTML5 Application Repository (app-host) and HANA HDI, a subscription
to SAP Build Work Zone, standard edition, and the `cf` CLI with the `multiapps` plugin and `mbt`.

```
cf login
cd sample
mbt build                                   # builds everything into mta_archives/*.mtar
cf deploy mta_archives/ui5-webmcp-odata-sample_1.0.0.mtar
```

The build installs the npm workspaces from the repository root first (the library is a workspace of this repo), so run
it from a full checkout of the repository, not from a copy of `sample/` alone.

**Then, in BTP and Work Zone**

1. *BTP cockpit > Security > Role Collections*: assign `Viewer (ui5-webmcp-odata-sample <org>-<space>)` and/or
   `Admin (…)` to your user (the role collections are created by the deployment).
2. *Work Zone > Channel Manager*: refresh the **HTML5 Apps** content provider so the deployed app shows up.
3. *Content Manager > Content Explorer > HTML5 Apps*: add the **Manage Books (WebMCP)** app to *My Content*, put it in a group and a
   role, and assign the role to a site.
4. Open the site and the tile, sign in again after changing role assignments.

**The app is in the BTP "HTML5 Applications" list but not in Work Zone's Content Manager?** Check, in this order:

1. The **destination service instance** needs `HTML5Runtime_enabled: true` (`config` of the destination resource in
   `mta.yaml`). A project generated by `cds add workzone-standard` has it; an earlier version of this sample did not
   and was not listed. This is the most likely cause, but it was not isolated on its own: the working version also
   differed in other ways.
2. Keep one name everywhere: `sap.app.id` in `manifest.json`, `metadata.name` and `archiveName` in `ui5.yaml`, the
   `@namespace` in `Component.ts`, the `mta.yaml` HTML5 module and the zip are all `ui5webmcpodatasamplebooks` in this
   sample (the name of the app in the HTML5 repo is the name of the zip). Whether Work Zone strictly requires the
   match was not verified, but a mismatch is an easy way to get a deployed app that does not start. After renaming an
   app, delete the old one from the HTML5 repo (`cf html5-list`, `cf html5-delete <name>`), otherwise it stays as an
   orphan.
3. The manifest needs an `sap.app.crossNavigation.inbounds` entry and `sap.cloud.service`, and the same service name
   must be on the destinations in `mta.yaml`. Apps without an intent are not offered.
4. Refresh the content provider: *Channel Manager > HTML5 Apps > Refresh* (the Content Manager caches the list).
5. The app needs the `html5-apps-repo` `app-host` instance of the same space the Work Zone content provider reads.
6. After a redeploy, re-add the app version to *My Content* if the tile still shows the old one.

**The app opens in Work Zone but `/odata/...` requests fail with 500?** The Work Zone log then says
`Error while retrieving destination srv-api from destination service. HTTP status code: 404`. The route in
`xs-app.json` names the destination `srv-api`, and with the current `mta.yaml` the destination service instance only
contains `…-auth` and `…-html5-repository` (check the cockpit). Such a request never reaches the CAP server, so the
server log (`cf logs <app>-srv --recent`) shows nothing for it. The cause is not resolved yet, see the open points
below.

**Not covered by the sample**: SAP Cloud Identity Services (IAS) instead of XSUAA, multitenancy, custom domains, and
CI/CD. See [Status](#status) for what was verified: the build, and that a version of this sample (before the final
renaming) was deployed to Cloud Foundry and listed in Work Zone.

---

## Development

```
npm install
npm test                # unit tests (packages/webmcp-odata)
npm run typecheck       # tsc over src and tests
npm run lint:ui5 --workspace=packages/webmcp-odata
```

- `packages/webmcp-odata/src/ui5/webmcp/odata/`: `WebMCP.ts` (entry), `metadata/` (introspection, capabilities, JSON
  Schema), `tools/` (entity set, operation and app tools), `runtime/` (keys, results, draft guard, binding refresh)
- `.mcp.json` configures the UI5, CAP and Fiori MCP servers, to look up APIs while developing (see `CLAUDE.md`)

---

## Status

- **Unit tests** (`npm test`): Edm to JSON Schema mapping, capability parsing, introspection against a metadata fixture.
- **UI5 linter** and `tsc`: clean.
- **In a browser**, against the sample, with a stand-in for `document.modelContext` that records `registerTool` calls
  (the handlers ran against the real `ODataModel`): registration from metadata (restricted sets get fewer tools),
  query/get/create/update/delete, deep create (also on a draft-enabled root), bound action with ETag, unbound action
  and function, hierarchy create with client-supplied IDs, draft guard for update/delete/bound action, a concurrent
  change during an update (reported as `precondition`, nothing overwritten), UI refresh of the Fiori elements list,
  selection and navigation tools, the delete confirmation dialog.
- **Deployment preparation**: the production CDS build, the app build with the library bundled into `ui5webmcpodatasamplebooks.zip`, and
  the full `mbt build` (produces `sample/mta_archives/*.mtar`; the app archive inside contains the library). The
  deployment itself is done by the project owner, see below. The final project (app id `ui5webmcpodatasamplebooks`) was built with
  `mbt build`, its ids were cross-checked, and it was run locally with `alice` and `bob`.
- **Cloud Foundry / Work Zone**: a version of the sample generated by `cds add` with the library added (same structure,
  other names) was deployed by the project owner and appeared in Work Zone's Content Explorer. The renamed version
  (`ui5-webmcp-odata-sample`) has not been deployed since the rename.

Not verified: registration through the browser's native WebMCP API, the WebMCP Inspector, and what happens when the
tools run inside the Work Zone iframe (a signed-in launch, the tools being visible to an agent, the HANA/XSUAA runtime
behavior of the deployed app).
