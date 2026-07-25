// ─── URL Importer (display) ────────────────────────────────────────
// Web port of packages/host/src/import/url-importer.ts. Pure `fetch` +
// schema validation, so the logic is identical to the TV host's; only
// the module layout differs (NodeNext-style `.js` specifiers).

import type { CardGameRuleset } from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";

/** Default maximum response size: 1 MB. */
const DEFAULT_MAX_SIZE_BYTES = 1_048_576;

/** Minimal shape of a Zod issue (path + message). */
interface ZodIssueLike {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** Formats Zod issues as `path: message`, joined by "; ". */
function formatZodIssues(issues: readonly ZodIssueLike[]): string {
  const details = issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Validation failed: ${details.join("; ")}`;
}

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

  // Early rejection via Content-Length, when the server sends one.
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

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read response body: ${message}` };
  }

  // Guard against servers that omit Content-Length.
  if (text.length > maxSizeBytes) {
    return {
      ok: false,
      error: `Response too large: ${text.length} bytes exceeds the ${maxSizeBytes} byte limit.`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Response is not valid JSON." };
  }

  const result = safeParseRuleset(json);
  if (!result.success) {
    return { ok: false, error: formatZodIssues(result.error.issues) };
  }

  return { ok: true, ruleset: result.data as CardGameRuleset };
}
