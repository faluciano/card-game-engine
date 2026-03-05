// ─── Built-in Rulesets ─────────────────────────────────────────────
// Module-level singleton for rulesets bundled with the app.
// Both RulesetPicker (UI) and useInstalledSlugs (bridge) import from here.

import { loadRuleset } from "@card-engine/shared";
import type { CardGameRuleset } from "@card-engine/shared";
import crazyEightsJson from "../../../../rulesets/crazy-eights.cardgame.json";

/**
 * Parse built-in rulesets once at module level.
 * Throws fast at startup if the bundled JSON is malformed.
 */
export const BUILT_IN_RULESETS: readonly CardGameRuleset[] = [
  loadRuleset(crazyEightsJson),
];

/** Slugs of all built-in rulesets, used for duplicate detection. */
export const BUILT_IN_SLUGS: readonly string[] = BUILT_IN_RULESETS.map(
  (rs) => rs.meta.slug,
);

/** Built-in slug + version pairs for merging into installedSlugs. */
export const BUILT_IN_INSTALLED: readonly { readonly slug: string; readonly version: string }[] =
  BUILT_IN_RULESETS.map((rs) => ({
    slug: rs.meta.slug,
    version: rs.meta.version,
  }));
