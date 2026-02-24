// ─── Ruleset Uninstaller Hook ──────────────────────────────────────
// Watches pendingUninstall in host state. When set, deletes the
// ruleset from FileRulesetStore and refreshes the installed list.

import { useEffect, useRef } from "react";
import { FileRulesetStore } from "../storage/file-ruleset-store";
import type { HostAction, HostGameState } from "../types/host-state";

/**
 * Watches `state.pendingUninstall` and removes the ruleset from disk
 * when a client requests an uninstall. Dispatches updated slug list
 * after deletion. Reducer stays pure — all I/O happens here.
 */
export function useRulesetUninstaller(
  pendingUninstall: HostGameState["pendingUninstall"],
  dispatch: (action: HostAction) => void,
): void {
  const uninstallingRef = useRef(false);

  useEffect(() => {
    if (!pendingUninstall) return;
    if (uninstallingRef.current) return;

    uninstallingRef.current = true;

    async function uninstall(): Promise<void> {
      try {
        const store = new FileRulesetStore();

        const existing = await store.getBySlug(pendingUninstall!);
        if (existing) {
          await store.delete(existing.id);
          console.log("[RulesetUninstaller] Removed:", pendingUninstall);
        } else {
          console.warn("[RulesetUninstaller] Not found:", pendingUninstall);
        }

        // Refresh the full slug + version list
        const rulesets = await store.list();
        const slugs = rulesets.map((r) => ({
          slug: r.ruleset.meta.slug,
          version: r.ruleset.meta.version,
        }));
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
      } catch (err) {
        console.error("[RulesetUninstaller] Uninstall failed:", err);
        // Refresh list even on error to clear pendingUninstall
        try {
          const store = new FileRulesetStore();
          const rulesets = await store.list();
          const slugs = rulesets.map((r) => ({
            slug: r.ruleset.meta.slug,
            version: r.ruleset.meta.version,
          }));
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs });
        } catch {
          // Last resort: dispatch empty list to clear pending state
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [] });
        }
      } finally {
        uninstallingRef.current = false;
      }
    }

    void uninstall();
  }, [pendingUninstall, dispatch]);
}
