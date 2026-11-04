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

| Option | Default | Meaning |
|---|---|---|
| `include` | all | Only these entity sets (and singletons) get tools. Also the way to get tools for CAP text tables (`Books_texts`), which are skipped by default |
| `exclude` | none | Entity sets that never get tools |
| `entitySets.<Set>.operations` | all | Narrow the CRUD tools of one set, e.g. `["query", "get"]`; metadata restrictions apply on top |
| `entitySets.<Set>.skipOperations` | `false` | No tools for actions and functions bound to this set |
| `operations` | all | `{ include?, exclude? }`: which actions and functions (by simple name, bound ones included) get tools |
| `toolPrefix` | `""` | Prefix for every tool name, e.g. `"bookshop."` |
| `maxTop` | `50` | Page size limit of query, aggregate and hierarchy tools |
| `maxResultChars` | `50000` | Largest tool result. A longer list loses rows from the end and is marked `truncated`; a single entry that is too large fails with `tooLarge` |
| `maxCompositionDepth` | `3` | How many composition levels deep create and update reach (Book → chapters → sections is 3) |
| `maxBatchItems` | `50` | Most entries one `.batch` call may create, update and delete together |
| `maxHierarchyNodes` | `1000` | Most nodes a hierarchy move or `ancestors` loads; larger hierarchies fail with `hierarchyTooLarge` |
| `confirmDestructive` | `true` | Ask the user before a delete (also inside a batch or a deep update) |
| `confirmWrites` | `false` | Also ask before create, update, move, batch and singleton update |
| `confirmActions` | `false` | Ask before actions run: `true` for all, or the names of the actions |
| `toolMode` | `"perSet"` | `"generic"` registers one tool per operation (`entity.query`, ...) that takes the entity set as an argument, see [Many entity sets](#many-entity-sets-generic-tools) |
| `genericThreshold` | off | Switch to the generic tools when more entity sets than this get tools |
| `exposedTo` | – | Origins allowed to call the tools, passed to `registerTool` |

Names in `include`, `exclude` and `entitySets` that the service does not have are logged as a warning. Every action
and function is exposed unless its set is excluded or `operations` filters it; an action the metadata marks as never
available (`Core.OperationAvailable: false`) gets no tool.

**Texts for the user.** Confirmation dialogs and toasts come from `i18n/i18n.properties` (English, German).
Everything addressed to the agent (tool descriptions, error messages) stays English on purpose. If the bundle cannot
be loaded, the built-in English texts are used. That is the case on the UI5 dev server with `transpileDependencies`,
which serves only the library's transpiled code; the built app serves the bundle.

---

## Generated tools

Names are `<EntitySet>.<operation>`; all tools return JSON.

**Per entity set**, only if the metadata allows it:

| Tool | Created unless | Notes |
|---|---|---|
| `.query` | `ReadRestrictions/Readable: false` | `filter`, `select`, `orderby`, `expand`, `search` (if searchable), `top`, `skip`. Returns `count` (total) and `hasMore`, in a stable order |
| `.get` | `ReadRestrictions/Readable: false` | by key |
| `.create` | `InsertRestrictions/Insertable: false` | compositions as nested data, several levels deep |
| `.update` | `UpdateRestrictions/Updatable: false` | `changes` plus the key, optional `etag`; compositions as nested data (deep update, below) |
| `.delete` | `DeleteRestrictions/Deletable: false` | asks the user to confirm; optional `etag` |
| `.batch` | the set is not insertable, updatable or deletable at all | `{ create?, update?, delete? }` in **one** request: all or nothing |
| `.aggregate` | no `Aggregation.ApplySupported` | `groupBy`, `aggregate` (`{property, with, as}`; no `with` for custom aggregates), `count`, `filter`, `orderby`, `top`, `skip`; only what the service announces |
| `.hierarchy`, `.move` | no `Aggregation.RecursiveHierarchy` | read a tree (`roots`, `children`, `descendants`, `ancestors`, `tree`); move a node with its subtree to a new parent |

In CAP, `@readonly` and `@insertonly` produce the restrictions and `@hierarchy` the recursive hierarchy;
`@Aggregation.ApplySupported` has to be annotated by hand (see the sample). **Singletons** (`@odata.singleton`) get
`<Name>.get`, and `<Name>.update` if the service allows it.

**Input schemas follow the metadata.**
- `Core.Computed` properties are not accepted on create; keys and `Core.Immutable` properties cannot be changed;
  non-nullable properties are required; `Core.ComputedDefaultValue` (CAP `cuid` keys) is optional on create.
- Respected restrictions: `NonInsertableProperties`, `NonUpdatableProperties`, `RequiredProperties`,
  `NonSortableProperties` (rejected in `orderby`), `ExpandRestrictions`, `CountRestrictions`, `TopSupported`.
- Edm types map to JSON Schema: `Int64` and `Decimal` are strings (as in the UI5 V4 model; `Decimal` gets a pattern
  from `precision`/`scale`), dates, durations and GUIDs carry a `format` or pattern, enums become `enum`, nullable
  properties accept `null`, collections become arrays, complex types objects, type definitions their underlying type.
  `Edm.Stream` and Geo properties are not writable.
- `Validation.Minimum/Maximum/AllowedValues` and static `Common.FieldControl` are applied; `Common.Label`,
  `Core.Description`, `Common.Text` and the target of `Common.ValueList` end up in the descriptions.

**Deep create and update.** Compositions are nested arrays or objects, up to `maxCompositionDepth` levels. Create
makes the whole tree in one request. On update, a composition array is the **full new set**, like a CAP deep `PATCH`:
children whose key exists are updated, children without a key are created, and children **missing from the array are
deleted** (an empty array deletes all; a composition left out of the input is untouched). A to-one composition
(`Books.cover`) is changed in place and `null` deletes it; a missing to-one child cannot be created by an update. It
all goes into one batch, so it is atomic, and the user is asked before children are deleted (`confirmDestructive`).

**Actions and functions** become tools: `<Name>` if unbound, `<EntitySet>.<Name>` if bound.
- Functions are read-only. A `Core.Description` on the operation becomes the tool description, so write one.
- A collection-bound action (`Authors.normalizeNames`) takes no key. Overloads (one name bound to several sets) get
  the parameters of their own set; colliding names get a numeric suffix.
- `Core.OperationAvailable`: `false` hides the tool; a path (`in/hasStock`) is checked on the entry and fails with
  `notAvailable` when it is `false`.
- Bound operations accept the entry's `etag`. `Common.SideEffects` limits what is refreshed afterwards.

**App tools**

| Tool | Purpose |
|---|---|
| `app.describe_service` | Entity sets, keys, properties, allowed operations, relations, compositions, aggregation rules, hierarchies, singletons, and which tools ask the user first. Agents should call this first |
| `app.refresh` | Re-read data for one entity set or everything |
| `app.get_messages` | Current UI5 messages (server errors and warnings) |
| `app.pending_changes` | Whether the user has unsaved edits |
| `app.reset_changes` | Discard the user's unsaved edits in all groups (asks to confirm) |
| `app.get_current_context` | URL hash, the rows selected in tables, and `currentEntity` (key and data of the open object page) |
| `app.navigate` | Open an entity set's list or one entry (Fiori elements hash `<Set>(<key>)`) |

### Many entity sets: generic tools

A service with 40 entity sets would get over 200 tools. With `toolMode: "generic"` (or `genericThreshold`) the library
registers one tool per operation instead: `entity.query`, `.get`, `.create`, `.update`, `.delete`, `.batch`,
`.aggregate`, `.hierarchy`, `.move`. Each takes `entitySet` and `arguments`, which are checked against the schema the
per-set tool would have and then run the same handler. `app.describe_service` with `entitySet` returns those schemas.
Actions, functions and singleton tools stay separate tools.

### Results

`{ ok, data?, key?, etag?, reason?, error?, ui?, messages[] }`. Failures carry a `reason` the agent can act on:

| Reason | Meaning |
|---|---|
| `validation` | 400: the service rejected a value; the details name the properties |
| `unauthenticated` / `forbidden` | 401 / 403 |
| `notFound`, `conflict`, `precondition` | 404, 409, 412 (changed by someone else: re-read and retry) |
| `draftExists` | a draft exists for the entry, see below |
| `declined` | the user said no in the confirmation dialog |
| `aborted` | the call was cancelled (`signal`); nothing was saved |
| `invalidInput`, `notExpandable`, `unknownEntitySet`, `invalidAggregation`, `invalidMove`, `invalidCharacters` | the input does not fit the metadata |
| `notAvailable`, `notChangeable`, `noChanges` | the operation or properties are not available for this entry |
| `hierarchyTooLarge`, `tooLarge` | more data than `maxHierarchyNodes` / `maxResultChars` allow |
| `error` | anything else |

`ui` reports what was refreshed and which bindings were skipped because of unsaved user changes. `messages` holds
what came up during that call (see Limitations). Results carrying service data (queries, functions, actions with a
return value, `app.get_messages`, aggregate, hierarchy) are marked `untrustedContentHint`.

---

## Draft-enabled entities

Tools never create or edit drafts. They read and write the **active** data directly, using CAP's draft bypass
(`cds.fiori.bypass_draft`, on by default); queries only return active entries.

Before an update, a delete, or a bound action on a **draft root**, the library reads `HasDraftEntity` and
`DraftAdministrativeData`. If a draft exists it refuses with `reason: "draftExists"` and says who holds it, because
activating that draft later would silently overwrite the change. The check runs before any confirmation dialog; for an
action on a draft **node** (`Chapters`) it is made against the root.

For changes and deletes CAP enforces the same on the server (checked against the sample), so the library is the
friendly layer and the server the backstop:

| Request on the active entity while a draft exists | Result |
|---|---|
| `PATCH` | `409 DRAFT_ALREADY_EXISTS` |
| `DELETE` | `403 DRAFT_ACTIVE_DELETE_FORBIDDEN_DRAFT_EXISTS` |
| `PATCH` with a stale `@odata.etag` | `412`, reported as `reason: "precondition"` |

CAP does **not** block bound actions while a draft exists (`addStock` on a book and an action on one of its chapters
both returned 200 with a draft open), so for actions the library's check is the only protection.

**Draft nodes.** Children of a draft tree can only be changed through their root: CAP answers a direct
`PATCH`/`POST`/`DELETE` on `/Chapters(ID)` with `422 DRAFT_MODIFICATION_ONLY_VIA_ROOT`. So nodes (detected through
`Common.DraftRoot`/`DraftNode`) get no create/update/delete tools; changes go through the root's `update`. The same
changes through the parent's navigation path (`/Books(..)/chapters(..)`) are accepted under the bypass, so deep update
uses `ODataModel` relative bindings and needs no raw `fetch`.

---

## How the UI is refreshed

Not with `requestSideEffects` on UI contexts. After a successful write or action, `refreshBindings`
(`runtime/BindingRefresher.ts`) calls `refresh()` on every **absolute list or context binding** of the affected entity
sets, i.e. the list report's table and an open object page, which re-reads the whole collection or entity. A refresh
is simple and always correct, at the price of an extra read; the tool works on its own detached binding, so there is no
UI context to target.

Refreshed are the written entity set and, after deep writes, every touched composition target and the parent sets
reached through partner navigation properties (so an open `Books` object page sees a changed `Chapter`). After an
action it is the sets named by its `Common.SideEffects` (`TargetEntities`), or everything if the service says nothing;
unbound actions refresh everything.

- Bindings with **pending user changes are skipped**, so an agent never discards unsaved edits. Their view stays stale
  until the user saves or cancels; `ui.skippedPendingChanges` says so.
- Relative bindings are refreshed only together with their parent binding.
- A finer approach (calling `requestSideEffects` on the table's context for the changed key) would cut traffic but is
  not implemented.

---

## Security and authorization

- Tools run **in the user's browser session**, with the user's token or cookie. An agent can do what the user can do,
  nothing more; your backend (XSUAA, `@restrict`, ...) checks every request as usual.
- Tools come from `$metadata`, which describes the *service*, not the current user (see [Limitations](#limitations)).
- Results with service data are marked `untrustedContentHint`: treat them as untrusted input to the agent (prompt
  injection through data is possible).
- **Confirmation is configurable.** Deletes ask by default (`confirmDestructive`); `confirmWrites` adds create,
  update, move, batch and singleton updates; `confirmActions` adds actions (all or by name). Tools that ask carry
  `consequentialHint` and are listed by `app.describe_service`. By default **actions and other writes do not ask**, so
  don't expose destructive actions you would not want triggered by a prompt, or turn the options on.
- Updates and deletes compare the entry's ETag with a fresh read, so an agent cannot overwrite changes made after it
  last read the entry (`precondition`).
- A query's `expand` is checked against the navigation properties, so draft data (`DraftAdministrativeData`,
  `SiblingEntity`) cannot be reached; results are bounded by `maxTop` and `maxResultChars`.
- A cancelled call (`signal`) does not submit and closes its confirmation dialog. `exposedTo` restricts which origins
  may call the tools.

---

## Limitations

**Platform**
- **OData V4 only**, through `sap.ui.model.odata.v4.ODataModel`. One model per `register` call.
- WebMCP is experimental. The handlers were verified with a stand-in for `document.modelContext`, and on a deployed
  Work Zone site the tools were seen and used through a WebMCP browser extension, also inside Work Zone's iframe (see
  [Status](#status)). Whether an agent sees tools registered in an iframe depends on the browser's WebMCP implementation.
- Developed and tested with SAPUI5 1.153/1.154 and CAP; other OData V4 backends should work but are untested. CAP's
  `$metadata` of the sample lacks several annotations the library reads (`NonUpdatableProperties`,
  `RequiredProperties`, ...), which are covered by unit tests only.

**Metadata and generation**
- Metadata is read **once at startup**; a changed service needs a reload. A failed read is logged and registers nothing.
- `$metadata` is not user specific: a read-only user may still get write tools and see them fail with `403`. Hide them
  with `entitySets.<Set>.operations` if that matters.
- Only static annotations are evaluated. Dynamic restrictions (path expressions) are not, except
  `Core.OperationAvailable` paths, which are checked on the loaded entry. `Common.SideEffects` is used for actions only,
  and only its entity targets decide what is refreshed.
- CAP text tables (`*_texts`) get no tools unless included, so translations cannot be edited.
- Media streams (`Edm.Stream`) and Geo types are not supported; `Edm.Binary` is passed as base64; operation parameters
  of entity type are free-form objects.
- Hierarchies: draft-enabled hierarchies and hierarchies with several key properties get no hierarchy tools;
  `nextSibling` is not offered for moves; `ancestors` walks up the parent key on the client because CAP's
  `ancestors(...)` only returns the start node.
- Aggregation: only `groupby`, `aggregate` and `filter`. Grouping is limited to the properties the service lists as
  groupable, so path expressions such as `groupby((author/name))`, which CAP accepts, are not offered. A custom
  aggregate (CAP: `@Aggregation.default` on the measure plus `@Aggregation.CustomAggregate#<name>`) has its own method,
  so `with` is left out; if the property is also listed as aggregatable, a `with` from that list is used instead.
- To-one compositions: an update changes the existing child or deletes it with `null`, but cannot create a missing one
  (it fails with a clear message); draft nodes have no create tool of their own.

**Behavior**
- `.query` returns at most `maxTop` rows per call; the agent pages with `skip` and sees `count` and `hasMore`.
- Drafts: active data only, no draft editing, check-then-write (a draft created between the check and the write is
  caught only by the server).
- Refresh gaps: see [How the UI is refreshed](#how-the-ui-is-refreshed). Relative list bindings re-request their
  children, so a deep update costs one extra GET per list.
- `messages` of a result are the UI5 messages that appeared since the call started; with **concurrent calls** one call
  can report a message that belongs to another.
- `app.get_current_context` finds tables by duck typing (controls with `getSelectedContexts`) and does not report
  field values being edited on an object page. `app.navigate` assumes the Fiori elements hash format.

**Deferred** (not part of this version): upload of media and `Edm.Stream` properties; per-user tool filtering (the
metadata is not user specific); publishing to npm and a JavaScript build; refreshing through `requestSideEffects` on UI
contexts.

**Packaging**: the library ships as TypeScript and is not published to npm, so consuming apps need
`ui5-tooling-transpile` and must bundle the library themselves (the sample does it with the zipper task).

---

## Sample app

`sample/` is a CAP bookshop with a Fiori elements list report/object page (`sample/app/books`) that exercises every
branch of the library:

| What | Where |
|---|---|
| Draft-enabled root with ETag and three levels of compositions | `Books` → `chapters` → `sections` |
| To-one composition | `Books.cover` → `Covers` |
| Plain CRUD; read-only; insert-only | `Authors`; `Currencies`; `Orders` |
| Recursive hierarchy, three levels | `Genres` (`@hierarchy`) |
| Aggregation (`Aggregation.ApplySupported`) | `Books`: group by genre, author, currency; sum/min/max/average of stock and price; `stock` is also a custom aggregate (`@Aggregation.default: #SUM`, as CAP documents it) |
| Singleton | `Shop` |
| Bound action with `Common.SideEffects` | `Books.addStock` |
| Bound action with `Core.OperationAvailable: in.hasStock` | `Books.sellOne` |
| One action name bound to two sets (overload) | `Books.rename(title)`, `Authors.rename(name)` |
| Action bound to a collection | `Authors.normalizeNames` (on `Books` it would need an `If-Match` header because of the ETag) |
| Action on a draft node | `Chapters.touch` |
| Server-side validation, to see a failing deep update | a chapter titled `BAD` is rejected |
| Unbound action and function | `emojifyBooks`, `topBooks` |

```
npm install
npm run watch          # cds watch, opens http://localhost:4004/ui5webmcpodatasamplebooks/index.html
```

It runs with an in-memory SQLite database (reset on every restart) and **mocked authentication**:

| User | Password | Roles |
|---|---|---|
| `alice` | `alice` | `Admin`: read, write, run actions |
| `bob` | `bob` | `Viewer`: read, and call `topBooks` |

The restrictions are declared on the entities and operations (`sample/srv/catalog-service.cds`; CAP ignores
`@restrict` on the *service* itself) and apply to the AI agent exactly as to the user. Checked in the browser: `bob`
can read, aggregate and call `topBooks`; every write, batch, action and singleton update fails with `forbidden`.
Because `$metadata` is identical for both users, `bob`'s agent still gets write tools.

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

- `packages/webmcp-odata/src/ui5/webmcp/odata/`: `WebMCP.ts` (entry), `metadata/` (introspection, annotations, JSON
  Schema and the pure decisions: `ApplyBuilder`, `DeepSchema`, `HierarchyQuery`, `ToolNames`, `Validate`,
  `ServiceDescription`), `tools/` (entity set, batch, aggregate, hierarchy, singleton, generic, operation, app),
  `runtime/` (keys, results, drafts, deep payload/diff/apply, groups, refresh, texts), `i18n/i18n*.properties`
- The node test runner cannot load UI5, so every decision lives in a pure module with its own test; the UI5 handlers
  stay thin and are verified in the browser against the sample.
- Texts for the user go through `text("key")` (`runtime/I18n.ts`); a test keeps the code, both bundles and the
  built-in defaults in sync.
- UI5 build lessons: an inline `export { x, type T }` compiles to a runtime reference and breaks the component, and
  tool modules must not import each other in a cycle (AMD).
- `.mcp.json` configures the UI5, CAP and Fiori MCP servers for looking up APIs (see `CLAUDE.md`).

**Browser checks.** Start the sample (`npx cds-serve --port 4004` in `sample/`). The automated Chrome cannot answer the
basic-auth prompt, so put a small proxy in front that adds the `Authorization` header, open the app through it with the
`document.modelContext` stand-in (step 5 above) as an init script, and call the tools. UI5 confirmation dialogs need a
real key press (`Enter`/`Escape`); a DOM `click()` does nothing. Don't leave a page with pending `$batch` requests
open: a few hung requests starve every other tab.

---

## Status

- **Unit tests** (`npm test`, 207) cover Edm to JSON Schema mapping, capability and annotation parsing, introspection
  against a metadata fixture (hierarchy, aggregation, singleton, overloads, collection-bound operations, draft nodes),
  deep schema/payload/diff, the `$apply` builder, hierarchy queries and the cycle check, tool names, the schema
  validator, write schemas, ETag and limit helpers, availability and side-effect targets, the service description and
  the message bundles. **UI5 linter** and `tsc`: clean.
- **In a browser**, against the sample, with a stand-in for `document.modelContext` (the handlers ran against the real
  `ODataModel`):
  - registration from metadata; query/get/create/update/delete with count, paging, ETags and `precondition`;
  - deep create on three levels; deep update that edits, creates and deletes children, atomically, with the
    confirmation before deletion; a to-one composition (create, change, `null` deletes); a self-composition
    (`Genres.children`: a left-out child is deleted with its subtree, three levels in one call); a server-side
    validation failure mid-update (`validation` with the property as target, nothing saved, no pending changes);
  - the draft guard (`draftExists` for update, delete, action, and an action on a draft node);
  - aggregation with draft data not counted, checked against CAP's documented `$apply` support (methods, `$count as`,
    custom aggregates with and without `with`, rejections); all hierarchy modes, moves with their subtree, cycle and
    unknown-node refusals;
  - batches with a rollback on a server-side validation failure; two concurrent updates; an aborted call that saves
    nothing;
  - `confirmWrites` (a declined update leaves the data unchanged) and `confirmActions`; generic mode (25 tools instead
    of 45) and `genericThreshold`;
  - the singleton, the overloaded `rename`, the collection-bound `normalizeNames`, `OperationAvailable`
    (`notAvailable` for a sold-out book), and the `bob` run (reads work, all writes `forbidden`);
  - UI refresh of the Fiori elements list, selection and navigation tools, `currentEntity`.
- **Deployment preparation**: the production CDS build, the app build with the library bundled into
  `ui5webmcpodatasamplebooks.zip` (it contains the i18n bundles), and the full `mbt build` (`sample/mta_archives/*.mtar`).
  The final project (app id `ui5webmcpodatasamplebooks`) was built, its ids cross-checked, and run locally with `alice`
  and `bob`. The `mbt build` predates this version's changes and was not repeated. Deployment itself is done by the
  project owner, see above.
- **Cloud Foundry / Work Zone**: a version of the sample generated by `cds add` with the library added (same
  structure, other names) was deployed by the project owner and appeared in Work Zone's Content Explorer. The renamed
  version (`ui5-webmcp-odata-sample`) has not been deployed since the rename. On a deployed Work Zone site the tools
  were registered through the browser's WebMCP API and visible to an agent through the WebMCP extension (so the iframe
  case works), and a confirmed update produced the expected requests (draft check, fresh read, the call, one refresh
  of the list).

Not verified: the German texts in a browser (the dev server does not serve the bundle, so it shows English); the
`SideEffects` target selection beyond the unit test (the list reloads after `addStock`, but only one list is on
screen, so it cannot show that other sets are skipped); the HANA/XSUAA runtime behavior of the deployed app.
