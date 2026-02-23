// ─── File Importer ─────────────────────────────────────────────────
// Imports a .cardgame.json ruleset from a local file.

import { File } from "expo-file-system";
import type { CardGameRuleset } from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";

import { formatZodIssues } from "./format-zod-issues";

/** Result of a file import attempt. Discriminated union. */
export type FileImportResult =
  | { readonly ok: true; readonly ruleset: CardGameRuleset }
  | { readonly ok: false; readonly error: string };

/**
 * Reads a local .cardgame.json file and parses it into a CardGameRuleset.
 * Validates the content with the Zod schema before returning.
 *
 * @param filePath - Absolute path to the .cardgame.json file.
 */
export async function importFromFile(
  filePath: string,
): Promise<FileImportResult> {
  if (!filePath.endsWith(".cardgame.json")) {
    return { ok: false, error: "File must have a .cardgame.json extension." };
  }

  // ── Read file contents ───────────────────────────────────────────
  let raw: string;
  try {
    raw = await new File(filePath).text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read file: ${message}` };
  }

  // ── Parse JSON ───────────────────────────────────────────────────
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }

  // ── Validate against schema ──────────────────────────────────────
  const result = safeParseRuleset(json);

  if (!result.success) {
    return { ok: false, error: formatZodIssues(result.error.issues) };
  }

  return { ok: true, ruleset: result.data as CardGameRuleset };
}
