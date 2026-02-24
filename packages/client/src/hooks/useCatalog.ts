// ─── Catalog Fetcher ───────────────────────────────────────────────
// Fetches the game catalog from GitHub Pages. Returns a discriminated
// union so consumers never deal with partial/undefined states.

import { useState, useEffect } from "react";
import type { CatalogGame } from "@card-engine/shared";

const CATALOG_URL =
  "https://faluciano.github.io/card-game-engine/catalog.json";

export type CatalogState =
  | { readonly tag: "loading" }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "loaded"; readonly games: readonly CatalogGame[] };

export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog(): Promise<void> {
      try {
        const res = await fetch(CATALOG_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: unknown = await res.json();
        if (cancelled) return;

        // Parse catalog envelope — catalog.json has shape { generatedAt, games[] }
        if (
          typeof data !== "object" ||
          data === null ||
          !("games" in data) ||
          !Array.isArray((data as { games: unknown }).games)
        ) {
          throw new Error("Invalid catalog format");
        }

        setState({
          tag: "loaded",
          games: (data as { games: readonly CatalogGame[] }).games,
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setState({ tag: "error", message });
      }
    }

    void fetchCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
