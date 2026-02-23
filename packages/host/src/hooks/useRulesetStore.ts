// ─── useRulesetStore ───────────────────────────────────────────────
// React hook providing reactive access to the file-based ruleset store.
// Handles loading, importing from URL, and deletion with auto-refresh.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { importFromUrl as fetchAndValidate } from "../import/url-importer";
import {
  FileRulesetStore,
  type StoredRuleset,
} from "../storage/file-ruleset-store";

/** Result of an import attempt. Discriminated union. */
export type ImportResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly duplicate: true; readonly slug: string; readonly error: string }
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
 * Provides reactive access to the file-based ruleset store.
 *
 * Loads all stored rulesets on mount and exposes actions
 * for importing from a URL and deleting rulesets, both of
 * which automatically refresh the list.
 *
 * @param builtInSlugs - Slugs of built-in rulesets, used for duplicate detection.
 */
export function useRulesetStore(builtInSlugs: readonly string[]): UseRulesetStoreResult {
  const storeRef = useRef(new FileRulesetStore());
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

  // Load rulesets on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const list = await storeRef.current.list();
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
  }, []);

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

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

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

  return { rulesets, isLoading, importFromUrl, importWithSlug, deleteRuleset, allSlugs };
}
