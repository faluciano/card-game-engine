// ─── Built-in Rulesets ─────────────────────────────────────────────
// Module-level singleton for rulesets bundled with the app.
// Both RulesetPicker (UI) and useInstalledSlugs (bridge) import from here.
// The JSON lives at the repo root; the relative path resolves from
// packages/host-core/src on both Metro and Vite.

import type { CardGameRuleset, CardValue } from "@card-engine/shared";
import crazyEightsJson from "../../../rulesets/crazy-eights.cardgame.json";

// ─── Trusted JSON → CardGameRuleset ────────────────────────────────
// Bundled rulesets are validated against the Zod schema by
// `bun run validate` in CI and by built-in-rulesets.test.ts (which checks
// that this zero-dependency path yields exactly what `parseRuleset` does).
// Doing the parse here at module level would put Zod on the startup path of
// the display and the TV host, so the bundled JSON is trusted at runtime and
// only the schema's one normalisation — bare-number card values become
// `{ kind: "fixed" }` — is replicated.

/** Shape of a bundled ruleset JSON module, as far as normalisation cares. */
interface BundledRulesetJson {
  readonly deck: {
    readonly cardValues: Readonly<Record<string, number | CardValue>>;
  };
}

/** Expands the `cardValues` number shorthand exactly like the schema does. */
function normalizeCardValue(value: number | CardValue): CardValue {
  return typeof value === "number" ? { kind: "fixed", value } : value;
}

/**
 * Casts a schema-valid bundled ruleset to `CardGameRuleset` without Zod.
 * Only for JSON that ships inside the app and is validated at build time.
 */
export function trustBundledRuleset(json: BundledRulesetJson): CardGameRuleset {
  const cardValues: Record<string, CardValue> = {};
  for (const [rank, value] of Object.entries(json.deck.cardValues)) {
    cardValues[rank] = normalizeCardValue(value);
  }
  return { ...json, deck: { ...json.deck, cardValues } } as unknown as CardGameRuleset;
}

/** Built-in rulesets, normalised once at module level. */
export const BUILT_IN_RULESETS: readonly CardGameRuleset[] = [trustBundledRuleset(crazyEightsJson)];

/** Slugs of all built-in rulesets, used for duplicate detection. */
export const BUILT_IN_SLUGS: readonly string[] = BUILT_IN_RULESETS.map((rs) => rs.meta.slug);

/** Built-in slug + version pairs for merging into installedSlugs. */
export const BUILT_IN_INSTALLED: readonly { readonly slug: string; readonly version: string }[] =
  BUILT_IN_RULESETS.map((rs) => ({
    slug: rs.meta.slug,
    version: rs.meta.version,
  }));
