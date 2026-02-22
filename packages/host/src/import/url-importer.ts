// ─── URL Importer ──────────────────────────────────────────────────
// Imports a .cardgame.json ruleset from a remote URL.

import type { CardGameRuleset } from "@card-engine/shared";

/** Result of a URL import attempt. Discriminated union. */
export type UrlImportResult =
  | { readonly ok: true; readonly ruleset: CardGameRuleset }
  | { readonly ok: false; readonly error: string };

/**
 * Fetches a .cardgame.json file from a URL and parses it.
 * Validates content-type and size before parsing.
 *
 * @param url - The URL to fetch the ruleset from.
 * @param maxSizeBytes - Maximum allowed response size (default: 1MB).
 */
export async function importFromUrl(
  url: string,
  maxSizeBytes: number = 1_048_576
): Promise<UrlImportResult> {
  if (!url.startsWith("https://")) {
    return { ok: false, error: "Only HTTPS URLs are allowed" };
  }

  // TODO: Fetch URL with timeout
  // TODO: Check Content-Length against maxSizeBytes
  // TODO: JSON.parse response body
  // TODO: Validate with parseRuleset from schema
  // TODO: Return parsed ruleset or error
  return { ok: false, error: "Not implemented: importFromUrl" };
}
