// ─── Cached Catalog Hook ───────────────────────────────────────────
// Stale-while-revalidate wrapper around `useCatalog` for the browser
// client. A fresh cache entry is served immediately (flagged `stale`)
// while the network request from `useCatalog` runs; a successful fetch
// replaces it and is written back to storage. `useCatalog` itself is
// left untouched because the TV host has no persistent storage.

import { useEffect, useMemo, useState } from "react";
import type { CatalogGame } from "@card-engine/shared";
import { useCatalog } from "../use-catalog";
import {
  CATALOG_CACHE_KEY,
  DEFAULT_CATALOG_TTL_MS,
  isCatalogCacheFresh,
  parseCatalogCache,
  serializeCatalogCache,
  type CatalogCacheStorage,
} from "./catalog-cache";

export type CachedCatalogState =
  | { readonly tag: "loading" }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "loaded"; readonly games: readonly CatalogGame[]; readonly stale: boolean };

export interface UseCachedCatalogResult {
  readonly catalog: CachedCatalogState;
  readonly refetch: () => void;
}

export interface UseCachedCatalogOptions {
  /** Where to persist the catalog; null disables caching (plain `useCatalog`). */
  readonly storage: CatalogCacheStorage | null;
  readonly ttlMs?: number;
  /** Clock, injectable for tests. */
  readonly now?: () => number;
}

function readFreshGames(
  storage: CatalogCacheStorage | null,
  ttlMs: number,
  now: number,
): readonly CatalogGame[] | null {
  if (storage === null) return null;
  try {
    const entry = parseCatalogCache(storage.getItem(CATALOG_CACHE_KEY));
    if (entry === null || !isCatalogCacheFresh(entry, now, ttlMs)) return null;
    return entry.games;
  } catch {
    return null;
  }
}

export function useCachedCatalog({
  storage,
  ttlMs = DEFAULT_CATALOG_TTL_MS,
  now = Date.now,
}: UseCachedCatalogOptions): UseCachedCatalogResult {
  const { catalog: network, refetch } = useCatalog();
  const [cachedGames] = useState(() => readFreshGames(storage, ttlMs, now()));

  useEffect(() => {
    if (network.tag !== "loaded" || storage === null) return;
    try {
      storage.setItem(CATALOG_CACHE_KEY, serializeCatalogCache(network.games, now()));
    } catch {
      // Storage full or unavailable — the in-memory result is still shown.
    }
  }, [network, storage, now]);

  const catalog = useMemo((): CachedCatalogState => {
    if (network.tag === "loaded") return { tag: "loaded", games: network.games, stale: false };
    if (cachedGames !== null) return { tag: "loaded", games: cachedGames, stale: true };
    return network;
  }, [network, cachedGames]);

  return { catalog, refetch };
}
