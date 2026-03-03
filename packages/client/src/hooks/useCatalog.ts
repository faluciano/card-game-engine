// ─── Catalog Fetcher ───────────────────────────────────────────────
// Fetches the game catalog from GitHub Pages with stale-while-revalidate
// caching. On mount, serves cached data immediately (marked stale), then
// revalidates from the network in the background. Exposes a refetch()
// function so consumers can retry without reloading the page.

import { useState, useEffect, useCallback } from "react";
import type { CatalogGame } from "@card-engine/shared";

const CATALOG_URL =
  "https://faluciano.github.io/card-game-engine/catalog.json";

const CACHE_KEY = "card-engine-catalog-cache";

// ─── Types ─────────────────────────────────────────────────────────

export type CatalogState =
  | { readonly tag: "loading" }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "loaded"; readonly games: readonly CatalogGame[]; readonly stale: boolean };

export interface UseCatalogResult {
  readonly catalog: CatalogState;
  readonly refetch: () => void;
}

interface CatalogCache {
  readonly fetchedAt: number;
  readonly games: CatalogGame[];
}

// ─── Cache helpers ─────────────────────────────────────────────────

function readCache(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("fetchedAt" in parsed) ||
      !("games" in parsed) ||
      typeof (parsed as CatalogCache).fetchedAt !== "number" ||
      !Array.isArray((parsed as CatalogCache).games)
    ) {
      return null;
    }

    return parsed as CatalogCache;
  } catch {
    return null;
  }
}

function writeCache(games: CatalogGame[]): void {
  try {
    const entry: CatalogCache = { fetchedAt: Date.now(), games };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

// ─── Catalog envelope parser ───────────────────────────────────────

function parseCatalogEnvelope(data: unknown): CatalogGame[] | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !("games" in data) ||
    !Array.isArray((data as { games: unknown }).games)
  ) {
    return null;
  }
  return (data as { games: CatalogGame[] }).games;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useCatalog(): UseCatalogResult {
  const [state, setState] = useState<CatalogState>(() => {
    const cached = readCache();
    if (cached !== null) {
      return { tag: "loaded", games: cached.games, stale: true };
    }
    return { tag: "loading" };
  });

  const [fetchCount, setFetchCount] = useState(0);

  const refetch = useCallback((): void => {
    setFetchCount((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog(): Promise<void> {
      try {
        const res = await fetch(CATALOG_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: unknown = await res.json();
        if (cancelled) return;

        const games = parseCatalogEnvelope(data);
        if (games === null) {
          throw new Error("Invalid catalog format");
        }

        writeCache(games);
        setState({ tag: "loaded", games, stale: false });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown error";

        setState((prev) => {
          // If we already have cached data showing, keep it stale
          if (prev.tag === "loaded") return prev;
          return { tag: "error", message };
        });
      }
    }

    void fetchCatalog();

    return () => {
      cancelled = true;
    };
  }, [fetchCount]);

  return { catalog: state, refetch };
}
