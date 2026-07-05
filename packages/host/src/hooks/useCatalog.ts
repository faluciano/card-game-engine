// ─── Catalog Fetcher (host) ────────────────────────────────────────
// Fetches the published game catalog from GitHub Pages so the TV can
// browse and install games directly (the "store"). Unlike the web
// client, the host runs under Hermes with no localStorage, so this is
// an in-memory fetch-on-mount with an explicit refetch().

import { useState, useEffect, useCallback } from "react";
import type { CatalogGame } from "@card-engine/shared";

export const CATALOG_BASE_URL =
  "https://faluciano.github.io/card-game-engine/";

const CATALOG_URL = `${CATALOG_BASE_URL}catalog.json`;

// ─── Types ─────────────────────────────────────────────────────────

export type CatalogState =
  | { readonly tag: "loading" }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "loaded"; readonly games: readonly CatalogGame[] };

export interface UseCatalogResult {
  readonly catalog: CatalogState;
  readonly refetch: () => void;
}

// ─── Envelope parser ───────────────────────────────────────────────

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
  const [catalog, setCatalog] = useState<CatalogState>({ tag: "loading" });
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => {
    setCatalog({ tag: "loading" });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch(CATALOG_URL);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: unknown = await res.json();
        const games = parseCatalogEnvelope(data);
        if (games === null) {
          throw new Error("Malformed catalog");
        }
        if (cancelled) return;
        setCatalog({ tag: "loaded", games });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to load catalog";
        setCatalog({ tag: "error", message });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { catalog, refetch };
}
