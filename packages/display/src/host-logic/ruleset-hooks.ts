// ─── Ruleset Orchestration Hooks (display) ─────────────────────────
// Web ports of the host's useInstalledSlugs / useRulesetInstaller /
// useRulesetUninstaller. Identical logic, but backed by WebRulesetStore
// (localStorage) instead of the RN FileRulesetStore (expo-file-system),
// and driven by the RelayDisplayHost's dispatch instead of useGameHost.

import { useEffect, useRef } from "react";
import { safeParseRuleset, type HostAction, type HostGameState } from "@card-engine/shared";
import { WebRulesetStore, type StoredRuleset } from "./web-ruleset-store.js";

type BuiltIn = { readonly slug: string; readonly version: string };

/** Built-in slugs first, then file-backed slugs not shadowed by a built-in. */
function mergeSlugs(
  builtInInstalled: readonly BuiltIn[],
  stored: readonly StoredRuleset[],
): BuiltIn[] {
  const fileSlugs = stored.map((r) => ({
    slug: r.ruleset.meta.slug,
    version: r.ruleset.meta.version,
  }));
  const seen = new Set(builtInInstalled.map((bi) => bi.slug));
  return [...builtInInstalled, ...fileSlugs.filter((fs) => !seen.has(fs.slug))];
}

/**
 * Loads installed rulesets from the store on mount, merges in built-ins, and
 * dispatches SET_INSTALLED_SLUGS so all clients see which games are available.
 */
export function useInstalledSlugs(
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly BuiltIn[],
): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await new WebRulesetStore().list();
      if (cancelled) return;
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, stored) });
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, builtInInstalled]);
}

/**
 * Watches `state.pendingInstall` and saves the ruleset to the store when a
 * client requests an install (deleting an existing entry with the same slug
 * first, enabling updates). The reducer stays pure; all I/O happens here.
 */
export function useRulesetInstaller(
  pendingInstall: HostGameState["pendingInstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly BuiltIn[],
): void {
  useEffect(() => {
    if (!pendingInstall) return;
    let aborted = false;

    async function refresh(store: WebRulesetStore): Promise<void> {
      const stored = await store.list();
      if (aborted) return;
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, stored) });
    }

    void (async () => {
      const store = new WebRulesetStore();
      try {
        const { ruleset, slug } = pendingInstall!;
        const result = safeParseRuleset(ruleset);
        if (!result.success) {
          console.warn("[RulesetInstaller] Invalid ruleset, skipping:", result.error);
          return;
        }
        const existing = await store.getBySlug(slug);
        if (aborted) return;
        if (existing) await store.delete(existing.id);
        if (aborted) return;
        await store.saveWithSlug(ruleset, slug);
        if (aborted) return;
        await refresh(store);
      } catch (err) {
        if (aborted) return;
        console.error("[RulesetInstaller] Install failed:", err);
        try {
          await refresh(store);
        } catch {
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
        }
      }
    })();

    return () => {
      aborted = true;
    };
  }, [pendingInstall, dispatch, builtInInstalled]);
}

/**
 * Watches `state.pendingUninstall` and removes the ruleset from the store when
 * a client requests an uninstall, then refreshes the installed list.
 */
export function useRulesetUninstaller(
  pendingUninstall: HostGameState["pendingUninstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly BuiltIn[],
): void {
  const uninstallingRef = useRef(false);

  useEffect(() => {
    if (!pendingUninstall) return;
    if (uninstallingRef.current) return;
    uninstallingRef.current = true;

    async function refresh(store: WebRulesetStore): Promise<void> {
      const stored = await store.list();
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, stored) });
    }

    void (async () => {
      const store = new WebRulesetStore();
      try {
        const existing = await store.getBySlug(pendingUninstall!);
        if (existing) await store.delete(existing.id);
        else console.warn("[RulesetUninstaller] Not found:", pendingUninstall);
        await refresh(store);
      } catch (err) {
        console.error("[RulesetUninstaller] Uninstall failed:", err);
        try {
          await refresh(store);
        } catch {
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
        }
      } finally {
        uninstallingRef.current = false;
      }
    })();
  }, [pendingUninstall, dispatch, builtInInstalled]);
}
