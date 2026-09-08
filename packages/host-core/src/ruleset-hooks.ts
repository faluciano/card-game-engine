// ─── Ruleset Orchestration Hooks ───────────────────────────────────
// Bridge between CouchKit host state and the platform's RulesetStore:
//   useInstalledSlugs    — loads installed slugs on boot, merges built-ins,
//                          and syncs them into host state for all clients.
//   useRulesetInstaller  — watches pendingInstall and persists the ruleset.
//   useRulesetUninstaller — watches pendingUninstall and deletes the ruleset.
// The reducer stays pure — all I/O happens here. Each hook takes the
// store instance so the TV host (expo-file-system) and the browser display
// (localStorage) share this code unchanged.

import { useEffect, useRef } from "react";
import { safeParseRuleset } from "@card-engine/shared";
import type { HostAction, HostGameState } from "@card-engine/shared";
import type { RulesetStore, StoredRuleset } from "./ruleset-store";

/** A slug + version pair as carried in `HostGameState.installedSlugs`. */
export interface InstalledSlug {
  readonly slug: string;
  readonly version: string;
}

/**
 * Built-in slugs first, then stored slugs not shadowed by a built-in.
 * Exported for tests; the hooks use it to build SET_INSTALLED_SLUGS.
 */
export function mergeSlugs(
  builtInInstalled: readonly InstalledSlug[],
  stored: readonly StoredRuleset[],
): InstalledSlug[] {
  const fileSlugs = stored.map((r) => ({
    slug: r.ruleset.meta.slug,
    version: r.ruleset.meta.version,
  }));
  const seen = new Set(builtInInstalled.map((bi) => bi.slug));
  return [...builtInInstalled, ...fileSlugs.filter((fs) => !seen.has(fs.slug))];
}

/**
 * Loads installed rulesets (slug + version) from the store on mount,
 * merges in built-in rulesets, and dispatches SET_INSTALLED_SLUGS so
 * all clients see which games are available on the host.
 */
export function useInstalledSlugs(
  store: RulesetStore,
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[],
): void {
  useEffect(() => {
    let cancelled = false;

    async function loadSlugs(): Promise<void> {
      const rulesets = await store.list();
      if (cancelled) return;
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
    }

    void loadSlugs();

    return () => {
      cancelled = true;
    };
  }, [store, dispatch, builtInInstalled]);
}

/**
 * Watches `state.pendingInstall` and saves the ruleset to the store when
 * a client requests an install. If the slug already exists, deletes
 * the old entry first (enabling seamless updates). Dispatches updated
 * slugs after saving.
 *
 * Uses the standard React async effect cleanup pattern: if
 * `pendingInstall` changes while a previous install is in-flight,
 * React tears down the old effect (setting `aborted = true`) and
 * fires a new one, so no install request is silently dropped.
 */
export function useRulesetInstaller(
  store: RulesetStore,
  pendingInstall: HostGameState["pendingInstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[],
): void {
  useEffect(() => {
    if (!pendingInstall) return;

    let aborted = false;

    // Refresh the full slug + version list from the store.
    async function refresh(): Promise<void> {
      const rulesets = await store.list();
      if (aborted) return;
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
    }

    async function install(): Promise<void> {
      try {
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
        }
        if (aborted) return;

        await store.saveWithSlug(ruleset, slug);
        if (aborted) return;

        await refresh();
      } catch (err) {
        if (aborted) return;
        console.error("[RulesetInstaller] Install failed:", err);
        // Re-read actual state from the store to clear pendingInstall without data loss
        try {
          await refresh();
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
  }, [store, pendingInstall, dispatch, builtInInstalled]);
}

/**
 * Watches `state.pendingUninstall` and removes the ruleset from the store
 * when a client requests an uninstall. Dispatches updated slug list
 * after deletion.
 */
export function useRulesetUninstaller(
  store: RulesetStore,
  pendingUninstall: HostGameState["pendingUninstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[],
): void {
  const uninstallingRef = useRef(false);

  useEffect(() => {
    if (!pendingUninstall) return;
    if (uninstallingRef.current) return;

    uninstallingRef.current = true;

    // Refresh the full slug + version list from the store.
    async function refresh(): Promise<void> {
      const rulesets = await store.list();
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
    }

    async function uninstall(): Promise<void> {
      try {
        const existing = await store.getBySlug(pendingUninstall!);
        if (existing) {
          await store.delete(existing.id);
        } else {
          console.warn("[RulesetUninstaller] Not found:", pendingUninstall);
        }

        await refresh();
      } catch (err) {
        console.error("[RulesetUninstaller] Uninstall failed:", err);
        // Refresh list even on error to clear pendingUninstall
        try {
          await refresh();
        } catch {
          // Last resort: dispatch built-in list to clear pending state
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
        }
      } finally {
        uninstallingRef.current = false;
      }
    }

    void uninstall();
  }, [store, pendingUninstall, dispatch, builtInInstalled]);
}
