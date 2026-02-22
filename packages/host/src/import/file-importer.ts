// ─── File Importer ─────────────────────────────────────────────────
// Imports a .cardgame.json ruleset from a local file.

import type { CardGameRuleset } from "@card-engine/shared";

/** Result of a file import attempt. Discriminated union. */
export type FileImportResult =
  | { readonly ok: true; readonly ruleset: CardGameRuleset }
  | { readonly ok: false; readonly error: string };

/**
 * Reads a local .cardgame.json file and parses it into a CardGameRuleset.
 * Validates the content before returning.
 *
 * @param filePath - Absolute path to the .cardgame.json file.
 */
export async function importFromFile(
  filePath: string
): Promise<FileImportResult> {
  if (!filePath.endsWith(".cardgame.json")) {
    return { ok: false, error: "File must have .cardgame.json extension" };
  }

  // TODO: Read file from filesystem
  // TODO: JSON.parse the contents
  // TODO: Validate with parseRuleset from schema
  // TODO: Return parsed ruleset or error
  return { ok: false, error: "Not implemented: importFromFile" };
}
