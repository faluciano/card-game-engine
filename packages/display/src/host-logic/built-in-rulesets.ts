// ─── Built-in Rulesets (display) ───────────────────────────────────
// Mirrors packages/host/src/built-in-rulesets.ts: parse the bundled
// rulesets once at module load so the display seeds the same built-in
// games into host state as the Android TV host.

import { loadRuleset } from "@card-engine/shared";
import type { CardGameRuleset } from "@card-engine/shared";
import crazyEightsJson from "../../../../rulesets/crazy-eights.cardgame.json" with { type: "json" };

export const BUILT_IN_RULESETS: readonly CardGameRuleset[] = [
  loadRuleset(crazyEightsJson),
];

export const BUILT_IN_SLUGS: readonly string[] = BUILT_IN_RULESETS.map(
  (rs) => rs.meta.slug,
);

/** Built-in slug + version pairs merged into installedSlugs. */
export const BUILT_IN_INSTALLED: readonly {
  readonly slug: string;
  readonly version: string;
}[] = BUILT_IN_RULESETS.map((rs) => ({
  slug: rs.meta.slug,
  version: rs.meta.version,
}));
