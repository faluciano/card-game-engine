// ─── useRulesetStore ───────────────────────────────────────────────
// React hook providing reactive access to the platform's ruleset store.
// Handles loading, importing from URL, and deletion with auto-refresh.
// Store failures never reject out of the hook: reads surface through
// `error`, imports return `{ ok: false }` results.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { importFromUrl as fetchAndValidate } from "./url-importer";
import { describeError } from "./ruleset-hooks";
import type { RulesetStore, StoredRuleset } from "./ruleset-store";

/** Result of an import attempt. Discriminated union. */
export type ImportResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly duplicate: true; readonly slug: string; readonly error: string }
  | { readonly ok: false; readonly duplicate?: false; readonly error: string };

export interface UseRulesetStoreResult {
  readonly rulesets: readonly StoredRuleset[];
  readonly isLoading: boolean;
  /**
   * Last store failure (initial load, refresh, save, or delete), or null.
   * Cleared by the next successful read. A corrupt library index or a
   * full storage quota lands here with its descriptive message.
   */
  readonly error: string | null;
  readonly importFromUrl: (url: string) => Promise<ImportResult>;
  readonly importWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  /** Deletes a ruleset. Never rejects: failures are reported through `error`. */
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
  const [error, setError] = useState<string | null>(null);

  // Guards every setState that follows an await in a callback, since those
  // can resolve after the picker screen has unmounted.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const allSlugs: readonly string[] = useMemo(
    () => [...builtInSlugs, ...rulesets.map((r) => r.ruleset.meta.slug)],
    [builtInSlugs, rulesets],
  );

  const refresh = useCallback(async () => {
    try {
      const list = await store.list();
      if (!mountedRef.current) return;
      setRulesets(list);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("[useRulesetStore] Could not read the ruleset library:", err);
      setError(describeError(err));
    }
  }, [store]);

  // Load rulesets on mount
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const list = await store.list();
        if (cancelled) return;
        setRulesets(list);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("[useRulesetStore] Could not read the ruleset library:", err);
        setError(describeError(err));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

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

  // Records a write failure on the hook and turns it into an import result.
  const failImport = useCallback((name: string, err: unknown): ImportResult => {
    const message = `Could not save "${name}": ${describeError(err)}`;
    console.error("[useRulesetStore]", message, err);
    if (mountedRef.current) setError(message);
    return { ok: false, error: message };
  }, []);

  const importFromUrl = useCallback(
    async (url: string): Promise<ImportResult> => {
      const result = await fetchAndValidate(url);

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      const { slug, name } = result.ruleset.meta;
      const duplicate: ImportResult = {
        ok: false,
        duplicate: true,
        slug,
        error: `A ruleset named '${slug}' already exists.`,
      };

      // Check for duplicate slug against built-in rulesets
      if (builtInSlugs.includes(slug)) return duplicate;

      try {
        // Check for duplicate slug in the store
        const existing = await store.getBySlug(slug);
        if (existing) return duplicate;

        await store.save(result.ruleset);
      } catch (err) {
        return failImport(name, err);
      }

      await refresh();
      return { ok: true, name };
    },
    [store, builtInSlugs, refresh, failImport],
  );

  const importWithSlug = useCallback(
    async (url: string, slug: string): Promise<ImportResult> => {
      const result = await fetchAndValidate(url);

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      const { name } = result.ruleset.meta;
      try {
        await store.saveWithSlug(result.ruleset, slug);
      } catch (err) {
        return failImport(name, err);
      }

      await refresh();
      return { ok: true, name };
    },
    [store, refresh, failImport],
  );

  const deleteRuleset = useCallback(
    async (id: string): Promise<void> => {
      try {
        await store.delete(id);
      } catch (err) {
        console.error("[useRulesetStore] Could not delete ruleset:", err);
        if (mountedRef.current) setError(`Could not delete ruleset: ${describeError(err)}`);
        return;
      }
      await refresh();
    },
    [store, refresh],
  );

  return {
    rulesets,
    isLoading,
    error,
    importFromUrl,
    importWithSlug,
    deleteRuleset,
    allSlugs,
  };
}
