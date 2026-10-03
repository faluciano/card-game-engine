// ─── useCatalogFilters ─────────────────────────────────────────────
// Filter state for the catalog browser: one reducer instead of four
// useStates, plus the derived filtered list and tag set.

import { useCallback, useMemo, useReducer } from "react";
import type { CatalogGame } from "@card-engine/shared";
import { INITIAL_CATALOG_FILTERS, catalogFilterReducer } from "../lib/catalog-filter-state.js";
import {
  extractUniqueTags,
  filterGames,
  hasManualFilters,
  type CatalogFilterState,
} from "../lib/catalog-filters.js";

export interface CatalogFilters {
  readonly filters: CatalogFilterState;
  readonly hasManualFilters: boolean;
  readonly allTags: readonly string[];
  readonly filteredGames: readonly CatalogGame[];
  readonly setSearch: (query: string) => void;
  readonly toggleTag: (tag: string) => void;
  readonly clearTags: () => void;
  readonly togglePlayerCount: (value: number) => void;
  readonly selectCategory: (index: number) => void;
  readonly clearAll: () => void;
}

export function useCatalogFilters(games: readonly CatalogGame[]): CatalogFilters {
  const [filters, dispatch] = useReducer(catalogFilterReducer, INITIAL_CATALOG_FILTERS);

  const allTags = useMemo(() => extractUniqueTags(games), [games]);
  const filteredGames = useMemo(() => filterGames(games, filters), [games, filters]);

  const setSearch = useCallback((query: string) => dispatch({ type: "set_search", query }), []);
  const toggleTag = useCallback((tag: string) => dispatch({ type: "toggle_tag", tag }), []);
  const clearTags = useCallback(() => dispatch({ type: "clear_tags" }), []);
  const togglePlayerCount = useCallback(
    (value: number) => dispatch({ type: "toggle_player_count", value }),
    [],
  );
  const selectCategory = useCallback(
    (index: number) => dispatch({ type: "select_category", index }),
    [],
  );
  const clearAll = useCallback(() => dispatch({ type: "clear_all" }), []);

  return {
    filters,
    hasManualFilters: hasManualFilters(filters),
    allTags,
    filteredGames,
    setSearch,
    toggleTag,
    clearTags,
    togglePlayerCount,
    selectCategory,
    clearAll,
  };
}
