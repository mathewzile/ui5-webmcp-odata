import ResourceBundle from "sap/base/i18n/ResourceBundle";
import { DEFAULT_TEXTS, formatText } from "./DefaultTexts";

let bundle: ResourceBundle | undefined;

/**
 * Loads `i18n/i18n.properties` of the library for the current language.
 * It is read straight from the library's resources, so it works whether or not the
 * application lists the library as a dependency.
 * Without it, `text` falls back to the built-in English texts.
 */
export async function loadTexts(): Promise<void> {
  try {
    bundle = await ResourceBundle.create({
      url: sap.ui.require.toUrl("ui5/webmcp/odata/i18n/i18n.properties"),
      async: true,
    });
  } catch {
    bundle = undefined;
  }
}

/** A text for the user (dialog, toast), in the user's language */
export function text(key: string, ...args: unknown[]): string {
  return (
    bundle?.getText(key, args.map(String), true) ??
    formatText(DEFAULT_TEXTS[key] ?? key, args)
  );
}
