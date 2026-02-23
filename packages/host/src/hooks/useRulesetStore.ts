// ─── useRulesetStore ───────────────────────────────────────────────
// React hook providing reactive access to the file-based ruleset store.
// Handles loading, importing from URL, and deletion with auto-refresh.

import { useState, useEffect, useCallback, useRef } from "react";
import type { CardGameRuleset } from "@card-engine/shared";
import { importFromUrl as fetchAndValidate } from "../import/url-importer";
import {
  FileRulesetStore,
  type StoredRuleset,
} from "../storage/file-ruleset-store";

/** Result of an import attempt. Discriminated union. */
type ImportResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly error: string };

interface UseRulesetStoreResult {
  readonly rulesets: readonly StoredRuleset[];
  readonly isLoading: boolean;
  readonly importFromUrl: (url: string) => Promise<ImportResult>;
  readonly deleteRuleset: (id: string) => Promise<void>;
}

/**
 * Provides reactive access to the file-based ruleset store.
 *
 * Loads all stored rulesets on mount and exposes actions
 * for importing from a URL and deleting rulesets, both of
 * which automatically refresh the list.
 */
export function useRulesetStore(): UseRulesetStoreResult {
  const storeRef = useRef(new FileRulesetStore());
  const [rulesets, setRulesets] = useState<readonly StoredRuleset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      // Check for duplicate slug
      const existing = await storeRef.current.getBySlug(
        result.ruleset.meta.slug,
      );
      if (existing) {
        return {
          ok: false,
          error: "A ruleset with this name is already imported.",
        };
      }

      await storeRef.current.save(result.ruleset);
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

  return { rulesets, isLoading, importFromUrl, deleteRuleset };
}
