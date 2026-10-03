import { describe, it, expect } from "vitest";
import type { CatalogGame } from "@card-engine/shared";
import {
  CATEGORIES,
  PLAYER_COUNTS,
  extractUniqueTags,
  filterGames,
  hasManualFilters,
  matchesCategory,
  matchesPlayerCount,
  matchesSearch,
  matchesTags,
  type CatalogFilterState,
} from "./catalog-filters.js";

// ─── Fixtures ──────────────────────────────────────────────────────

function game(overrides: Partial<CatalogGame> & { readonly slug: string }): CatalogGame {
  return {
    name: overrides.slug,
    version: "1.0.0",
    author: "test",
    players: { min: 2, max: 4 },
    file: `rulesets/${overrides.slug}.cardgame.json`,
    ...overrides,
  };
}

const BLACKJACK = game({
  slug: "blackjack",
  name: "Blackjack",
  description: "Beat the dealer to 21",
  tags: ["casino", "banking"],
  players: { min: 1, max: 6 },
});
const CRAZY_EIGHTS = game({
  slug: "crazy-eights",
  name: "Crazy Eights",
  description: "Shed your hand",
  tags: ["shedding", "family"],
  players: { min: 2, max: 4 },
});
const HEARTS = game({
  slug: "hearts",
  name: "Hearts",
  tags: ["classic"],
  players: { min: 4, max: 4 },
});
const BIG_TABLE = game({ slug: "big-table", name: "Big Table", players: { min: 6, max: 8 } });

const GAMES = [BLACKJACK, CRAZY_EIGHTS, HEARTS, BIG_TABLE];

const NO_FILTERS: CatalogFilterState = {
  searchQuery: "",
  activeTags: new Set(),
  playerCount: null,
  categoryIndex: 0,
};

const option = (label: string) => PLAYER_COUNTS.find((o) => o.label === label)!;

// ─── matchesSearch ─────────────────────────────────────────────────

describe("matchesSearch", () => {
  it("matches everything for an empty or whitespace query", () => {
    expect(matchesSearch(HEARTS, "")).toBe(true);
    expect(matchesSearch(HEARTS, "   ")).toBe(true);
  });

  it("matches the name case-insensitively", () => {
    expect(matchesSearch(BLACKJACK, "BLACK")).toBe(true);
  });

  it("matches the description when present", () => {
    expect(matchesSearch(BLACKJACK, "dealer")).toBe(true);
    expect(matchesSearch(HEARTS, "dealer")).toBe(false);
  });
});

// ─── matchesTags ───────────────────────────────────────────────────

describe("matchesTags", () => {
  it("matches everything when no tags are active", () => {
    expect(matchesTags(BIG_TABLE, new Set())).toBe(true);
  });

  it("matches when any active tag is present (OR semantics)", () => {
    expect(matchesTags(CRAZY_EIGHTS, new Set(["family", "casino"]))).toBe(true);
    expect(matchesTags(HEARTS, new Set(["family", "casino"]))).toBe(false);
  });

  it("treats a game without tags as not matching", () => {
    expect(matchesTags(BIG_TABLE, new Set(["classic"]))).toBe(false);
  });
});

// ─── matchesPlayerCount ────────────────────────────────────────────

describe("matchesPlayerCount", () => {
  it("matches everything when no count is selected", () => {
    expect(matchesPlayerCount(HEARTS, null)).toBe(true);
  });

  it("requires an exact count to fall inside the supported range", () => {
    expect(matchesPlayerCount(HEARTS, option("4P"))).toBe(true);
    expect(matchesPlayerCount(HEARTS, option("3P"))).toBe(false);
    expect(matchesPlayerCount(BLACKJACK, option("2P"))).toBe(true);
  });

  it("regression: '5+' includes games whose minimum is above five", () => {
    // Previously `min <= 5` excluded 6–8 player games from the 5+ chip.
    expect(matchesPlayerCount(BIG_TABLE, option("5+"))).toBe(true);
  });

  it("'5+' includes games that stretch to five or more and excludes smaller tables", () => {
    expect(matchesPlayerCount(BLACKJACK, option("5+"))).toBe(true);
    expect(matchesPlayerCount(CRAZY_EIGHTS, option("5+"))).toBe(false);
    expect(matchesPlayerCount(HEARTS, option("5+"))).toBe(false);
  });
});

// ─── matchesCategory ───────────────────────────────────────────────

describe("matchesCategory", () => {
  it("'All Games' has null tags and matches everything", () => {
    expect(CATEGORIES[0]!.tags).toBeNull();
    expect(matchesCategory(BIG_TABLE, null)).toBe(true);
  });

  it("matches on any of the category tags", () => {
    expect(matchesCategory(BLACKJACK, ["casino", "banking"])).toBe(true);
    expect(matchesCategory(CRAZY_EIGHTS, ["casino", "banking"])).toBe(false);
  });
});

// ─── extractUniqueTags ─────────────────────────────────────────────

describe("extractUniqueTags", () => {
  it("collects tags once each, in first-seen order", () => {
    const games = [
      game({ slug: "a", tags: ["x", "y"] }),
      game({ slug: "b", tags: ["y", "z"] }),
      game({ slug: "c" }),
    ];
    expect(extractUniqueTags(games)).toEqual(["x", "y", "z"]);
  });

  it("returns an empty list for no games", () => {
    expect(extractUniqueTags([])).toEqual([]);
  });
});

// ─── filterGames ───────────────────────────────────────────────────

describe("filterGames", () => {
  it("applies the category when no manual filters are active", () => {
    const casino = CATEGORIES.findIndex((c) => c.name === "Casino");
    expect(filterGames(GAMES, { ...NO_FILTERS, categoryIndex: casino })).toEqual([BLACKJACK]);
  });

  it("falls back to 'All Games' for an out-of-range category index", () => {
    expect(filterGames(GAMES, { ...NO_FILTERS, categoryIndex: 99 })).toEqual(GAMES);
  });

  it("ignores the category once a manual filter is set", () => {
    const casino = CATEGORIES.findIndex((c) => c.name === "Casino");
    const filters = { ...NO_FILTERS, categoryIndex: casino, searchQuery: "hearts" };
    expect(hasManualFilters(filters)).toBe(true);
    expect(filterGames(GAMES, filters)).toEqual([HEARTS]);
  });

  it("combines search, tags and player count with AND semantics", () => {
    const filters: CatalogFilterState = {
      ...NO_FILTERS,
      searchQuery: "e",
      activeTags: new Set(["shedding", "casino"]),
      playerCount: option("4P"),
    };
    expect(filterGames(GAMES, filters)).toEqual([BLACKJACK, CRAZY_EIGHTS]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterGames(GAMES, { ...NO_FILTERS, searchQuery: "poker" })).toEqual([]);
  });
});
