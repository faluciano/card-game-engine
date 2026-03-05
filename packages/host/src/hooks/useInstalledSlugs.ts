// ─── Installed Slugs Loader ────────────────────────────────────────
// Loads installed ruleset slugs + versions from FileRulesetStore on
// boot, merges in built-in rulesets, and syncs them into CouchKit host
// state so all clients see them.

import { useEffect } from "react";
import { FileRulesetStore } from "../storage/file-ruleset-store";
import type { HostAction } from "../types/host-state";

/**
 * Loads installed rulesets (slug + version) from filesystem on mount,
 * merges in built-in rulesets, and dispatches SET_INSTALLED_SLUGS so
 * all clients see which games are available on the TV.
 */
export function useInstalledSlugs(
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly { readonly slug: string; readonly version: string }[],
): void {
  useEffect(() => {
    let cancelled = false;

    async function loadSlugs(): Promise<void> {
      const store = new FileRulesetStore();
      const rulesets = await store.list();
      if (cancelled) return;

      const fileSlugs = rulesets.map((r) => ({
        slug: r.ruleset.meta.slug,
        version: r.ruleset.meta.version,
      }));

      // Merge built-in slugs with file-based slugs (built-in first, deduped)
      const seen = new Set(builtInInstalled.map((bi) => bi.slug));
      const merged = [
        ...builtInInstalled,
        ...fileSlugs.filter((fs) => !seen.has(fs.slug)),
      ];

      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: merged });
    }

    void loadSlugs();

    return () => {
      cancelled = true;
    };
  }, [dispatch, builtInInstalled]);
}
