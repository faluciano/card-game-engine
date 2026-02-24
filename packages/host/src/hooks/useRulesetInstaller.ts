// ─── Ruleset Installer Hook ────────────────────────────────────────
// Watches pendingInstall in host state. When set, validates and saves
// the ruleset to FileRulesetStore, then dispatches SET_INSTALLED_SLUGS
// to sync all clients.

import { useEffect, useRef } from "react";
import { FileRulesetStore } from "../storage/file-ruleset-store";
import { safeParseRuleset } from "@card-engine/schema";
import type { HostAction, HostGameState } from "../types/host-state";

/**
 * Watches `state.pendingInstall` and saves the ruleset to disk when
 * a client requests an install. Dispatches updated slugs after saving.
 * Reducer stays pure — all I/O happens here.
 */
export function useRulesetInstaller(
  pendingInstall: HostGameState["pendingInstall"],
  dispatch: (action: HostAction) => void,
): void {
  const installingRef = useRef(false);

  useEffect(() => {
    if (!pendingInstall) return;
    if (installingRef.current) return;

    installingRef.current = true;

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

        // Check if already installed
        const existing = await store.getBySlug(slug);
        if (existing) {
          console.log("[RulesetInstaller] Already installed:", slug);
        } else {
          await store.saveWithSlug(ruleset, slug);
          console.log("[RulesetInstaller] Installed:", slug);
        }

        // Refresh the full slug list
        const rulesets = await store.list();
        const slugs = rulesets.map((r) => r.ruleset.meta.slug);
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
      } catch (err) {
        console.error("[RulesetInstaller] Install failed:", err);
        // Clear pendingInstall even on error to avoid retry loop
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [] });
      } finally {
        installingRef.current = false;
      }
    }

    void install();
  }, [pendingInstall, dispatch]);
}
