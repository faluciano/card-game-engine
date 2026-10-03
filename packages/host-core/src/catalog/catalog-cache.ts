// ─── Catalog Cache ─────────────────────────────────────────────────
// Pure helpers for the browser client's stale-while-revalidate catalog
// cache. Storage is injected (localStorage in practice) so these stay
// testable and the TV host — which has no localStorage — never touches
// them. Entries carry `fetchedAt` and expire after a TTL.

import type { CatalogGame } from "@card-engine/shared";
import { parseCatalogEnvelope } from "../use-catalog";

export const CATALOG_CACHE_KEY = "card-engine-catalog-cache";

/** Cached catalogs older than this are ignored on startup (24 hours). */
export const DEFAULT_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export interface CatalogCacheEntry {
  readonly fetchedAt: number;
  readonly games: readonly CatalogGame[];
}

/** The subset of the Web Storage API the cache needs. */
export interface CatalogCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parses a serialized cache entry; null when absent or malformed. */
export function parseCatalogCache(raw: string | null): CatalogCacheEntry | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("fetchedAt" in parsed)) {
      return null;
    }
    const fetchedAt = (parsed as { fetchedAt: unknown }).fetchedAt;
    if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return null;
    const games = parseCatalogEnvelope(parsed);
    if (games === null) return null;
    return { fetchedAt, games };
  } catch {
    return null;
  }
}

/** True when the entry was fetched within `ttlMs` of `now`. */
export function isCatalogCacheFresh(
  entry: CatalogCacheEntry,
  now: number,
  ttlMs: number = DEFAULT_CATALOG_TTL_MS,
): boolean {
  const age = now - entry.fetchedAt;
  return age >= 0 && age <= ttlMs;
}

export function serializeCatalogCache(games: readonly CatalogGame[], now: number): string {
  const entry: CatalogCacheEntry = { fetchedAt: now, games };
  return JSON.stringify(entry);
}
