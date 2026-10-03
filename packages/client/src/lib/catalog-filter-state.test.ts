import { describe, it, expect } from "vitest";
import { INITIAL_CATALOG_FILTERS, catalogFilterReducer } from "./catalog-filter-state.js";
import type { CatalogFilterState } from "./catalog-filters.js";

const reduce = (
  state: CatalogFilterState,
  ...actions: Parameters<typeof catalogFilterReducer>[1][]
): CatalogFilterState => actions.reduce(catalogFilterReducer, state);

describe("catalogFilterReducer", () => {
  it("sets the search query", () => {
    const next = reduce(INITIAL_CATALOG_FILTERS, { type: "set_search", query: "war" });
    expect(next.searchQuery).toBe("war");
  });

  it("toggles tags on and off without mutating the previous set", () => {
    const on = reduce(INITIAL_CATALOG_FILTERS, { type: "toggle_tag", tag: "classic" });
    expect([...on.activeTags]).toEqual(["classic"]);
    expect(INITIAL_CATALOG_FILTERS.activeTags.size).toBe(0);

    const off = reduce(on, { type: "toggle_tag", tag: "classic" });
    expect(off.activeTags.size).toBe(0);
  });

  it("clears tags, returning the same state when none are active", () => {
    expect(reduce(INITIAL_CATALOG_FILTERS, { type: "clear_tags" })).toBe(INITIAL_CATALOG_FILTERS);
    const withTags = reduce(INITIAL_CATALOG_FILTERS, { type: "toggle_tag", tag: "x" });
    expect(reduce(withTags, { type: "clear_tags" }).activeTags.size).toBe(0);
  });

  it("toggles the player count option and resolves it from PLAYER_COUNTS", () => {
    const on = reduce(INITIAL_CATALOG_FILTERS, { type: "toggle_player_count", value: 5 });
    expect(on.playerCount).toEqual({ label: "5+", value: 5, orMore: true });

    const off = reduce(on, { type: "toggle_player_count", value: 5 });
    expect(off.playerCount).toBeNull();
  });

  it("switching player count replaces the previous option", () => {
    const next = reduce(
      INITIAL_CATALOG_FILTERS,
      { type: "toggle_player_count", value: 2 },
      { type: "toggle_player_count", value: 3 },
    );
    expect(next.playerCount?.value).toBe(3);
  });

  it("ignores unknown player count values", () => {
    const next = reduce(INITIAL_CATALOG_FILTERS, { type: "toggle_player_count", value: 42 });
    expect(next.playerCount).toBeNull();
  });

  it("selecting a category clears every manual filter", () => {
    const dirty = reduce(
      INITIAL_CATALOG_FILTERS,
      { type: "set_search", query: "x" },
      { type: "toggle_tag", tag: "classic" },
      { type: "toggle_player_count", value: 2 },
    );
    const next = reduce(dirty, { type: "select_category", index: 3 });
    expect(next).toEqual({ ...INITIAL_CATALOG_FILTERS, categoryIndex: 3 });
  });

  it("clear_all resets to the initial state", () => {
    const dirty = reduce(
      INITIAL_CATALOG_FILTERS,
      { type: "select_category", index: 2 },
      { type: "set_search", query: "x" },
    );
    expect(reduce(dirty, { type: "clear_all" })).toBe(INITIAL_CATALOG_FILTERS);
  });
});
