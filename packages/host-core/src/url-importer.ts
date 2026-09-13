// ─── URL Importer ──────────────────────────────────────────────────
// Imports a .cardgame.json ruleset from a remote URL.

import type { CardGameRuleset } from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";

import { formatZodIssues } from "./format-zod-issues";

/** Default maximum response size: 1 MB. */
const DEFAULT_MAX_SIZE_BYTES = 1_048_576;

/** Result of a URL import attempt. Discriminated union. */
export type UrlImportResult =
  | { readonly ok: true; readonly ruleset: CardGameRuleset }
  | { readonly ok: false; readonly error: string };

/**
 * Fetches a .cardgame.json file from a URL and parses it.
 * Validates HTTPS, response size, and schema before returning.
 *
 * @param url - The HTTPS URL to fetch the ruleset from.
 * @param maxSizeBytes - Maximum allowed response size (default: 1 MB).
 */
export async function importFromUrl(
  url: string,
  maxSizeBytes: number = DEFAULT_MAX_SIZE_BYTES,
): Promise<UrlImportResult> {
  if (!url.startsWith("https://")) {
    return { ok: false, error: "Only HTTPS URLs are allowed." };
  }

  // ── Fetch remote resource ────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network request failed: ${message}` };
  }

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
  }

  // ── Check Content-Length header (early rejection) ────────────────
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const size = Number(contentLength);
    if (!Number.isNaN(size) && size > maxSizeBytes) {
      return {
        ok: false,
        error: `Response too large: ${size} bytes exceeds the ${maxSizeBytes} byte limit.`,
      };
    }
  }

  // ── Read response body ───────────────────────────────────────────
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read response body: ${message}` };
  }

  // Guard against servers that omit Content-Length
  if (text.length > maxSizeBytes) {
    return {
      ok: false,
      error: `Response too large: ${text.length} bytes exceeds the ${maxSizeBytes} byte limit.`,
    };
  }

  // ── Parse JSON ───────────────────────────────────────────────────
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response is not valid JSON." };
  }

  // ── Validate against schema ──────────────────────────────────────
  const result = safeParseRuleset(json);

  if (!result.success) {
    return { ok: false, error: formatZodIssues(result.error.issues) };
  }

  return { ok: true, ruleset: result.data as CardGameRuleset };
}
