// ─── useRulesetStore ───────────────────────────────────────────────
// React hook providing reactive access to the platform's ruleset store.
// Handles loading, importing from URL, and deletion with auto-refresh.

import { useState, useEffect, useCallback, useMemo } from "react";
import { importFromUrl as fetchAndValidate } from "./url-importer";
import type { RulesetStore, StoredRuleset } from "./ruleset-store";

/** Result of an import attempt. Discriminated union. */
export type ImportResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly duplicate: true; readonly slug: string; readonly error: string }
  | { readonly ok: false; readonly duplicate?: false; readonly error: string };

export interface UseRulesetStoreResult {
  readonly rulesets: readonly StoredRuleset[];
  readonly isLoading: boolean;
  readonly importFromUrl: (url: string) => Promise<ImportResult>;
  readonly importWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly deleteRuleset: (id: string) => Promise<void>;
  readonly allSlugs: readonly string[];
}

/**
 * Provides reactive access to the platform's ruleset store.
 *
 * Loads all stored rulesets on mount and exposes actions
 * for importing from a URL and deleting rulesets, both of
 * which automatically refresh the list.
 *
 * When `installedSlugs` changes (e.g. a phone installs or removes a game
 * via CouchKit sync), the hook automatically re-fetches from disk so the
 * TV's RulesetPicker grid stays up to date.
 *
 * @param store - Platform ruleset store; pass a stable (module-level) instance.
 * @param builtInSlugs - Slugs of built-in rulesets, used for duplicate detection.
 * @param installedSlugs - CouchKit-synced slug list; triggers a refresh when it changes.
 */
export function useRulesetStore(
  store: RulesetStore,
  builtInSlugs: readonly string[],
  installedSlugs?: readonly { slug: string; version: string }[],
): UseRulesetStoreResult {
  const [rulesets, setRulesets] = useState<readonly StoredRuleset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const allSlugs: readonly string[] = useMemo(
    () => [...builtInSlugs, ...rulesets.map((r) => r.ruleset.meta.slug)],
    [builtInSlugs, rulesets],
  );

  const refresh = useCallback(async () => {
    const list = await store.list();
    setRulesets(list);
  }, [store]);

  // Load rulesets on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await store.list();
        if (!cancelled) {
          setRulesets(list);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [store]);

  // Re-fetch from the store when external installs/uninstalls update the synced slug list.
  // Use `undefined` sentinel (no prop) vs `""` (empty list) so removing the last
  // installed game still triggers a refresh instead of being swallowed by a falsy guard.
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

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      const slug = result.ruleset.meta.slug;

      // Check for duplicate slug against built-in rulesets
      if (builtInSlugs.includes(slug)) {
        return {
          ok: false,
          duplicate: true,
          slug,
          error: `A ruleset named '${slug}' already exists.`,
        };
      }

      // Check for duplicate slug in file store
      const existing = await store.getBySlug(slug);
      if (existing) {
        return {
          ok: false,
          duplicate: true,
          slug,
          error: `A ruleset named '${slug}' already exists.`,
        };
      }

      await store.save(result.ruleset);
      await refresh();

      return { ok: true, name: result.ruleset.meta.name };
    },
    [store, builtInSlugs, refresh],
  );

  const importWithSlug = useCallback(
    async (url: string, slug: string): Promise<ImportResult> => {
      const result = await fetchAndValidate(url);

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      await store.saveWithSlug(result.ruleset, slug);
      await refresh();

      return { ok: true, name: result.ruleset.meta.name };
    },
    [store, refresh],
  );

  const deleteRuleset = useCallback(
    async (id: string): Promise<void> => {
      await store.delete(id);
      await refresh();
    },
    [store, refresh],
  );

  return { rulesets, isLoading, importFromUrl, importWithSlug, deleteRuleset, allSlugs };
}
