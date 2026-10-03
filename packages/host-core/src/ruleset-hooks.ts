// ─── Ruleset Orchestration Hooks ───────────────────────────────────
// Bridge between CouchKit host state and the platform's RulesetStore:
//   useInstalledSlugs    — loads installed slugs on boot, merges built-ins,
//                          and syncs them into host state for all clients.
//   useRulesetInstaller  — watches pendingInstall and persists the ruleset.
//   useRulesetUninstaller — watches pendingUninstall and deletes the ruleset.
// The reducer stays pure — all I/O happens here. Each hook takes the
// store instance so the TV host (expo-file-system) and the browser display
// (localStorage) share this code unchanged.
//
// Every hook returns a `RulesetHookStatus` whose `error` is the last
// failure (or null). HostAction has no failure variant, so pending state
// is always cleared through SET_INSTALLED_SLUGS and the reason is
// reported to the host UI through this return value.

import { useEffect, useRef, useState } from "react";
import type { HostAction, HostGameState } from "@card-engine/shared";
import type { RulesetStore, StoredRuleset } from "./ruleset-store";
import { formatZodIssues } from "./format-zod-issues";

/** A slug + version pair as carried in `HostGameState.installedSlugs`. */
export interface InstalledSlug {
  readonly slug: string;
  readonly version: string;
}

/** Last failure reported by a ruleset hook, or null when its last run succeeded. */
export interface RulesetHookStatus {
  readonly error: string | null;
}

/** Human-readable message for an unknown thrown value. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 *
 * If the store cannot be read, the built-in list is dispatched instead so
 * the host still boots with its bundled games, and `error` carries why.
 */
export function useInstalledSlugs(
  store: RulesetStore,
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[],
): RulesetHookStatus {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSlugs(): Promise<void> {
      try {
        const rulesets = await store.list();
        if (cancelled) return;
        setError(null);
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
      } catch (err) {
        if (cancelled) return;
        console.error(
          "[InstalledSlugs] Could not read the ruleset library; falling back to built-ins:",
          err,
        );
        setError(describeError(err));
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
      }
    }

    void loadSlugs();

    return () => {
      cancelled = true;
    };
  }, [store, dispatch, builtInInstalled]);

  return { error };
}

/**
 * Watches `state.pendingInstall` and saves the ruleset to the store when
 * a client requests an install. If the slug already exists, deletes
 * the old entry first (enabling seamless updates). Dispatches updated
 * slugs after saving.
 *
 * Every outcome — success, schema rejection, or I/O failure — ends with a
 * SET_INSTALLED_SLUGS dispatch so `pendingInstall` is cleared and phones
 * never stay on "Installing…". Failures are exposed through `error`.
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
): RulesetHookStatus {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingInstall) return;

    const { ruleset, slug } = pendingInstall;
    let aborted = false;

    // Refresh the full slug + version list from the store.
    async function refresh(): Promise<void> {
      const rulesets = await store.list();
      if (aborted) return;
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
    }

    // Clears pendingInstall even when the store itself cannot be read.
    async function clearPending(): Promise<void> {
      try {
        await refresh();
      } catch (err) {
        if (aborted) return;
        console.error("[RulesetInstaller] Could not re-read the library after a failure:", err);
        dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
      }
    }

    async function install(): Promise<void> {
      setError(null);
      try {
        // Validate before saving (defense in depth — client already validated).
        // Loaded on demand so Zod stays off the display/host startup path.
        const { safeParseRuleset } = await import("@card-engine/shared/schema");
        if (aborted) return;
        const result = safeParseRuleset(ruleset);
        if (!result.success) {
          const message = `Ruleset "${slug}" was rejected: ${formatZodIssues(result.error.issues)}`;
          console.warn("[RulesetInstaller]", message);
          setError(message);
          await clearPending();
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
        setError(`Could not install "${slug}": ${describeError(err)}`);
        await clearPending();
      }
    }

    void install();

    return () => {
      aborted = true;
    };
  }, [store, pendingInstall, dispatch, builtInInstalled]);

  return { error };
}

/**
 * Watches `state.pendingUninstall` and removes the ruleset from the store
 * when a client requests an uninstall. Dispatches updated slug list
 * after deletion; failures are exposed through `error`.
 */
export function useRulesetUninstaller(
  store: RulesetStore,
  pendingUninstall: HostGameState["pendingUninstall"],
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[],
): RulesetHookStatus {
  const [error, setError] = useState<string | null>(null);
  const uninstallingRef = useRef(false);

  useEffect(() => {
    if (!pendingUninstall) return;
    if (uninstallingRef.current) return;

    uninstallingRef.current = true;
    const slug = pendingUninstall;

    // Refresh the full slug + version list from the store.
    async function refresh(): Promise<void> {
      const rulesets = await store.list();
      dispatch({ type: "SET_INSTALLED_SLUGS", slugs: mergeSlugs(builtInInstalled, rulesets) });
    }

    async function uninstall(): Promise<void> {
      setError(null);
      try {
        const existing = await store.getBySlug(slug);
        if (existing) {
          await store.delete(existing.id);
        } else {
          console.warn("[RulesetUninstaller] Not found:", slug);
        }

        await refresh();
      } catch (err) {
        console.error("[RulesetUninstaller] Uninstall failed:", err);
        setError(`Could not remove "${slug}": ${describeError(err)}`);
        // Refresh list even on error to clear pendingUninstall
        try {
          await refresh();
        } catch (refreshErr) {
          console.error(
            "[RulesetUninstaller] Could not re-read the library after a failure:",
            refreshErr,
          );
          dispatch({ type: "SET_INSTALLED_SLUGS", slugs: [...builtInInstalled] });
        }
      } finally {
        uninstallingRef.current = false;
      }
    }

    void uninstall();
  }, [store, pendingUninstall, dispatch, builtInInstalled]);

  return { error };
}
