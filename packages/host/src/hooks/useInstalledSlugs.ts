// ─── Installed Slugs Loader ────────────────────────────────────────
// Loads installed ruleset slugs + versions from FileRulesetStore on
// boot and syncs them into CouchKit host state so all clients see them.

import { useEffect } from "react";
import { FileRulesetStore } from "../storage/file-ruleset-store";
import type { HostAction } from "../types/host-state";

/**
 * Loads installed rulesets (slug + version) from filesystem on mount
 * and dispatches SET_INSTALLED_SLUGS so all clients see which games
 * are available on the TV.
 */
export function useInstalledSlugs(
  dispatch: (action: HostAction) => void,
): void {
  useEffect(() => {
    let cancelled = false;

    async function loadSlugs(): Promise<void> {
      const store = new FileRulesetStore();
      const rulesets = await store.list();
      if (cancelled) return;

      const slugs = rulesets.map((r) => ({
        slug: r.ruleset.meta.slug,
        version: r.ruleset.meta.version,
      }));
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
    }

    void loadSlugs();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);
}
