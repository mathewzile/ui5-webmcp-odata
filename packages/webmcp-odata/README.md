# ui5-webmcp-odata

A UI5 library (`ui5.webmcp.odata`) that reads an **OData V4** service's `$metadata` and registers
[WebMCP](https://github.com/webmachinelearning/webmcp) tools for its entity sets and operations, so an AI agent
in the browser can read and change the app's data through the app's own `ODataModel`.

> **Experimental (0.x):** this package is experimental and its API may change between minor versions.
> WebMCP (`document.modelContext`) is also an experimental browser API. Without it the library does nothing.

## Install

```sh
npm install ui5-webmcp-odata
```

The package contains plain JavaScript and `.d.ts` files. UI5 tooling picks it up from `node_modules` through its
`ui5.yaml`; no transpile setup is needed. Requires SAPUI5 1.120+ (developed and tested with 1.153).

### TypeScript apps

The `.d.ts` files declare ambient modules, so tell TypeScript about the package in your `tsconfig.json`. Otherwise
`import ODataWebMCP from "ui5/webmcp/odata/WebMCP"` fails with TS2307. Recommended (TypeScript 5.9, 6 and 7):

```jsonc
"compilerOptions": { "types": ["@sapui5/types", "qunit", "ui5-webmcp-odata"] }
```

Projects that use `typeRoots` can add `./node_modules/ui5-webmcp-odata/types` there (from TypeScript 6 also set
`types`), or add `./node_modules/ui5-webmcp-odata/src/**/*.d.ts` to `include`. Details in the
[full README](https://github.com/mathewzile/ui5-webmcp-odata#readme).

## Documentation

Setup, options, generated tools, draft handling and security notes are in the
[full README](https://github.com/mathewzile/ui5-webmcp-odata#readme).

## License

MIT
