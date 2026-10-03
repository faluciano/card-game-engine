// ─── Catalog Filter State ──────────────────────────────────────────
// Reducer behind `useCatalogFilters`. Kept framework-free so transitions
// (toggle semantics, category resets) can be tested directly.

import { PLAYER_COUNTS, type CatalogFilterState } from "./catalog-filters.js";

export type CatalogFilterAction =
  | { readonly type: "set_search"; readonly query: string }
  | { readonly type: "toggle_tag"; readonly tag: string }
  | { readonly type: "clear_tags" }
  | { readonly type: "toggle_player_count"; readonly value: number }
  /** Picks a category tab, which also clears every manual filter. */
  | { readonly type: "select_category"; readonly index: number }
  | { readonly type: "clear_all" };

export const INITIAL_CATALOG_FILTERS: CatalogFilterState = {
  searchQuery: "",
  activeTags: new Set<string>(),
  playerCount: null,
  categoryIndex: 0,
};

export function catalogFilterReducer(
  state: CatalogFilterState,
  action: CatalogFilterAction,
): CatalogFilterState {
  switch (action.type) {
    case "set_search":
      return { ...state, searchQuery: action.query };

    case "toggle_tag": {
      const next = new Set(state.activeTags);
      if (next.has(action.tag)) {
        next.delete(action.tag);
      } else {
        next.add(action.tag);
      }
      return { ...state, activeTags: next };
    }

    case "clear_tags":
      return state.activeTags.size === 0 ? state : { ...state, activeTags: new Set<string>() };

    case "toggle_player_count": {
      if (state.playerCount?.value === action.value) return { ...state, playerCount: null };
      const option = PLAYER_COUNTS.find((o) => o.value === action.value) ?? null;
      return { ...state, playerCount: option };
    }

    case "select_category":
      return { ...INITIAL_CATALOG_FILTERS, categoryIndex: action.index };

    case "clear_all":
      return INITIAL_CATALOG_FILTERS;
  }
}
