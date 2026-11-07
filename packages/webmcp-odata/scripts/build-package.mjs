// Builds the publishable package into dist/package: plain JavaScript (+ .d.ts), no TypeScript sources,
// no tsconfig and no transpile tooling needed by the consumer. Publish that folder, not this one.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui5Out = join(root, "dist", "ui5");
const pkgOut = join(root, "dist", "package");
const libPath = "ui5/webmcp/odata";

// Empty the folders instead of deleting them: on Windows a folder that is some shell's working directory
// (for example after `cd dist/package && npm pack`) cannot be removed.
const empty = (dir) => {
	mkdirSync(dir, { recursive: true });
	for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
};
empty(ui5Out);
empty(pkgOut);
execFileSync(
	process.execPath,
	[
		createRequire(import.meta.url).resolve("@ui5/cli/bin/ui5.cjs"),
		"build",
		"--dest", ui5Out,
		"--exclude-task", "minify",
		"--exclude-task", "generateLibraryPreload",
		"--exclude-task", "buildThemes"
	],
	{ cwd: root, stdio: "inherit" }
);

const built = join(ui5Out, "resources", libPath);
const target = join(pkgOut, "src", libPath);
const keep = (path) => {
	if (statSync(path).isDirectory()) return true;
	return (/\.(js|properties)$/.test(path) || path.endsWith(".d.ts") || path.endsWith(".library"))
		&& !path.endsWith("-dbg.js");
};
mkdirSync(target, { recursive: true });
cpSync(built, target, { recursive: true, filter: keep });

// the source maps point to .ts files that are not shipped
const strip = (dir) => {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) { strip(path); continue; }
		if (/\.(js|d\.ts)$/.test(name)) {
			writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n\/\/# sourceMappingURL=.*\s*$/, "\n"));
		}
	}
};
strip(target);

// Entry point for TypeScript consumers: the .d.ts files declare ambient modules, so they only become known once
// something references them. Apps use it in one of two ways: "./node_modules/ui5-webmcp-odata/types" as a
// compilerOptions.typeRoots entry (every subfolder of a type root is a type package, so the index sits in
// types/ui5-webmcp-odata and not in the package root next to src/), or the package name in compilerOptions.types
// ("types" in package.json points at the index).
const declarations = [];
const collect = (dir) => {
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) collect(path);
		else if (name.endsWith(".d.ts")) declarations.push(path.slice(pkgOut.length + 1).replaceAll("\\", "/"));
	}
};
collect(join(pkgOut, "src"));
mkdirSync(join(pkgOut, "types", "ui5-webmcp-odata"), { recursive: true });
writeFileSync(
	join(pkgOut, "types", "ui5-webmcp-odata", "index.d.ts"),
	declarations.map((file) => `/// <reference path="../../${file}" />`).join("\n") + "\n"
);

const src = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = {
	name: src.name,
	version: src.version,
	description: src.description,
	keywords: src.keywords,
	license: src.license,
	author: src.author,
	homepage: src.homepage,
	repository: src.repository,
	bugs: src.bugs,
	main: `src/${libPath}/library.js`,
	types: "types/ui5-webmcp-odata/index.d.ts",
	files: ["src/", "types/", "ui5.yaml", "README.md", "LICENSE"],
	engines: src.engines
};
writeFileSync(join(pkgOut, "package.json"), JSON.stringify(out, null, 2) + "\n");

writeFileSync(join(pkgOut, "ui5.yaml"), `specVersion: "4.0"
type: library
metadata:
  name: ui5.webmcp.odata
framework:
  name: SAPUI5
  version: "1.153.0"
  libraries:
    - name: sap.ui.core
    - name: sap.m
`);
cpSync(join(root, "README.md"), join(pkgOut, "README.md"));
cpSync(join(root, "LICENSE"), join(pkgOut, "LICENSE"));
console.log(`Package built in ${pkgOut}`);
