// ─── Ruleset Installer Hook ────────────────────────────────────────
// Watches pendingInstall in host state. When set, validates and saves
// the ruleset to FileRulesetStore, then dispatches SET_INSTALLED_SLUGS
// to sync all clients. Handles updates by deleting the old version first.

import { useEffect } from "react";
import { FileRulesetStore } from "../storage/file-ruleset-store";
import { safeParseRuleset } from "@card-engine/shared";
import type { HostAction, HostGameState } from "../types/host-state";

/**
 * Watches `state.pendingInstall` and saves the ruleset to disk when
 * a client requests an install. If the slug already exists, deletes
 * the old entry first (enabling seamless updates). Dispatches updated
 * slugs after saving. Reducer stays pure — all I/O happens here.
 *
 * Uses the standard React async effect cleanup pattern: if
 * `pendingInstall` changes while a previous install is in-flight,
 * React tears down the old effect (setting `aborted = true`) and
 * fires a new one, so no install request is silently dropped.
 */
export function useRulesetInstaller(
  pendingInstall: HostGameState["pendingInstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly { readonly slug: string; readonly version: string }[],
): void {
  useEffect(() => {
    if (!pendingInstall) return;

    let aborted = false;

    async function install(): Promise<void> {
      try {
        const store = new FileRulesetStore();
        const { ruleset, slug } = pendingInstall!;

        // Validate before saving (defense in depth — client already validated)
        const result = safeParseRuleset(ruleset);
        if (!result.success) {
          console.warn("[RulesetInstaller] Invalid ruleset, skipping:", result.error);
          return;
        }

        // If slug already exists, delete the old entry first (update path)
        const existing = await store.getBySlug(slug);
        if (aborted) return;

        if (existing) {
          await store.delete(existing.id);
          console.log("[RulesetInstaller] Replacing existing:", slug);
        }
        if (aborted) return;

        await store.saveWithSlug(ruleset, slug);
        if (aborted) return;
        console.log("[RulesetInstaller] Installed:", slug);

        // Refresh the full slug + version list
        const rulesets = await store.list();
        if (aborted) return;
        const fileSlugs = rulesets.map((r) => ({
          slug: r.ruleset.meta.slug,
          version: r.ruleset.meta.version,
        }));
        const seen = new Set(builtInInstalled.map((bi) => bi.slug));
        const slugs = [
          ...builtInInstalled,
          ...fileSlugs.filter((fs) => !seen.has(fs.slug)),
        ];
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
      } catch (err) {
        if (aborted) return;
        console.error("[RulesetInstaller] Install failed:", err);
        // Re-read actual state from disk to clear pendingInstall without data loss
        try {
          const store = new FileRulesetStore();
          const rulesets = await store.list();
          if (aborted) return;
          const fileSlugs = rulesets.map((r) => ({
            slug: r.ruleset.meta.slug,
            version: r.ruleset.meta.version,
          }));
          const seen = new Set(builtInInstalled.map((bi) => bi.slug));
          const slugs = [
            ...builtInInstalled,
            ...fileSlugs.filter((fs) => !seen.has(fs.slug)),
          ];
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
        } catch {
          // Last resort: dispatch built-in list to clear pending state
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
        }
      }
    }

    void install();

    return () => {
      aborted = true;
    };
  }, [pendingInstall, dispatch, builtInInstalled]);
}
