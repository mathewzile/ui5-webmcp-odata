import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_TEXTS,
  formatText,
} from "../src/ui5/webmcp/odata/runtime/DefaultTexts";

const root = join(import.meta.dirname, "../src/ui5/webmcp/odata");

/** key → text of a .properties file, without comments */
function bundle(file: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(join(root, file), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("message bundle", () => {
  const english = bundle("i18n/i18n.properties");
  const keys = Object.keys(english);
  const used = new Set(
    sources(root)
      .filter((file) => !file.endsWith("I18n.ts") && !file.endsWith("DefaultTexts.ts"))
      .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/\btext\("(\w+)"/g)].map((m) => m[1])),
  );

  it("has every text the code asks for", () => {
    assert.deepEqual([...used].filter((key) => !keys.includes(key)), []);
  });

  it("has no text nobody asks for", () => {
    assert.deepEqual(keys.filter((key) => !used.has(key)), []);
  });

  it("is translated completely into German", () => {
    assert.deepEqual(Object.keys(bundle("i18n/i18n_de.properties")).sort(), [...keys].sort());
  });

  it("uses the same placeholders in every language", () => {
    const placeholders = (texts: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(texts).map(([key, value]) => [key, (value.match(/\{\d\}/g) ?? []).sort().join()]),
      );
    assert.deepEqual(placeholders(bundle("i18n/i18n_de.properties")), placeholders(english));
  });

  it("has built-in English defaults identical to the English bundle", () => {
    assert.deepEqual(DEFAULT_TEXTS, english);
  });

  it("fills placeholders and leaves missing arguments alone", () => {
    assert.equal(formatText("{0}: {1} changes", ["Book", 3]), "Book: 3 changes");
    assert.equal(formatText("{0} and {1}", ["a"]), "a and {1}");
  });
});
