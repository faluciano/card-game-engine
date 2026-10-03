// ─── Built-in Slugs (JSON-free copy) ───────────────────────────────
// `../built-in-rulesets.ts` derives BUILT_IN_SLUGS from the bundled
// ruleset JSON at the repo root. The phone controller only needs the
// slugs — to hide "Remove" on games the host cannot uninstall — and must
// not ship the rulesets themselves, so the list is repeated here.
// `built-in-slugs.test.ts` asserts the two stay in sync.

export const BUILT_IN_SLUGS: readonly string[] = ["crazy-eights"];

export function isBuiltInSlug(slug: string): boolean {
  return BUILT_IN_SLUGS.includes(slug);
}
