// ─── useRulesetStore (display) ─────────────────────────────────────
// Web port of packages/host/src/hooks/useRulesetStore.ts, backed by
// WebRulesetStore (localStorage) instead of FileRulesetStore.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { importFromUrl as fetchAndValidate } from "./url-importer.js";
import { WebRulesetStore, type StoredRuleset } from "./web-ruleset-store.js";

/** Result of an import attempt. Discriminated union. */
export type ImportResult =
  | { readonly ok: true; readonly name: string }
  | {
      readonly ok: false;
      readonly duplicate: true;
      readonly slug: string;
      readonly error: string;
    }
  | { readonly ok: false; readonly duplicate?: false; readonly error: string };

interface UseRulesetStoreResult {
  readonly rulesets: readonly StoredRuleset[];
  readonly isLoading: boolean;
  readonly importFromUrl: (url: string) => Promise<ImportResult>;
  readonly importWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly deleteRuleset: (id: string) => Promise<void>;
  readonly allSlugs: readonly string[];
}

/**
 * Reactive access to the browser ruleset store.
 *
 * Loads stored rulesets on mount and exposes import/delete actions that
 * refresh the list. Re-reads storage whenever `installedSlugs` changes (a
 * phone installing or removing a game through the relay), so the picker grid
 * stays in sync with host state.
 *
 * @param builtInSlugs - Slugs of built-in rulesets, used for duplicate detection.
 * @param installedSlugs - Relay-synced slug list; triggers a refresh when it changes.
 */
export function useRulesetStore(
  builtInSlugs: readonly string[],
  installedSlugs?: readonly { slug: string; version: string }[],
): UseRulesetStoreResult {
  const storeRef = useRef(new WebRulesetStore());
  const [rulesets, setRulesets] = useState<readonly StoredRuleset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const allSlugs: readonly string[] = useMemo(
    () => [...builtInSlugs, ...rulesets.map((r) => r.ruleset.meta.slug)],
    [builtInSlugs, rulesets],
  );

  const refresh = useCallback(async () => {
    const list = await storeRef.current.list();
    setRulesets(list);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const list = await storeRef.current.list();
        if (!cancelled) setRulesets(list);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read storage when external installs/uninstalls update the synced slug
  // list. The `undefined` sentinel (prop omitted) is distinct from `""` (empty
  // list) so removing the last installed game still triggers a refresh.
  const slugKey =
    installedSlugs != null
      ? installedSlugs.map((s) => `${s.slug}@${s.version}`).join(",")
      : undefined;
  useEffect(() => {
    if (slugKey === undefined) return;
    void refresh();
  }, [slugKey, refresh]);

  const importFromUrl = useCallback(
    async (url: string): Promise<ImportResult> => {
      const result = await fetchAndValidate(url);
      if (!result.ok) return { ok: false, error: result.error };

      const slug = result.ruleset.meta.slug;

      if (builtInSlugs.includes(slug)) {
        return {
          ok: false,
          duplicate: true,
          slug,
          error: `A ruleset named '${slug}' already exists.`,
        };
      }

      const existing = await storeRef.current.getBySlug(slug);
      if (existing) {
        return {
          ok: false,
          duplicate: true,
          slug,
          error: `A ruleset named '${slug}' already exists.`,
        };
      }

      await storeRef.current.save(result.ruleset);
      await refresh();

      return { ok: true, name: result.ruleset.meta.name };
    },
    [builtInSlugs, refresh],
  );

  const importWithSlug = useCallback(
    async (url: string, slug: string): Promise<ImportResult> => {
      const result = await fetchAndValidate(url);
      if (!result.ok) return { ok: false, error: result.error };

      await storeRef.current.saveWithSlug(result.ruleset, slug);
      await refresh();

      return { ok: true, name: result.ruleset.meta.name };
    },
    [refresh],
  );

  const deleteRuleset = useCallback(
    async (id: string): Promise<void> => {
      await storeRef.current.delete(id);
      await refresh();
    },
    [refresh],
  );

  return {
    rulesets,
    isLoading,
    importFromUrl,
    importWithSlug,
    deleteRuleset,
    allSlugs,
  };
}
