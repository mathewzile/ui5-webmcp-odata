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

rmSync(join(root, "dist"), { recursive: true, force: true });
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
	types: `src/${libPath}/library.d.ts`,
	files: ["src/", "ui5.yaml", "README.md", "LICENSE"],
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
