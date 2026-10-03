// ─── Catalog Filters ───────────────────────────────────────────────
// Pure predicates and option tables for the catalog browser. The screen
// only wires these to state; everything that decides which games show
// lives here so it can be unit-tested.

import type { CatalogGame } from "@card-engine/shared";

// ─── Options ───────────────────────────────────────────────────────

export interface Category {
  readonly name: string;
  /** null = every game. */
  readonly tags: readonly string[] | null;
}

export const CATEGORIES: readonly Category[] = [
  { name: "All Games", tags: null },
  { name: "Classic", tags: ["classic"] },
  { name: "Family Friendly", tags: ["family", "kids", "simple"] },
  { name: "Card Shedding", tags: ["shedding", "matching"] },
  { name: "Casino", tags: ["casino", "banking"] },
];

export interface PlayerCountOption {
  readonly label: string;
  readonly value: number;
  /** "5+" style chip: matches games that support `value` or more players. */
  readonly orMore: boolean;
}

export const PLAYER_COUNTS: readonly PlayerCountOption[] = [
  { label: "2P", value: 2, orMore: false },
  { label: "3P", value: 3, orMore: false },
  { label: "4P", value: 4, orMore: false },
  { label: "5+", value: 5, orMore: true },
];

// ─── Predicates ────────────────────────────────────────────────────

export function matchesSearch(game: CatalogGame, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const nameMatch = game.name.toLowerCase().includes(q);
  const descMatch = game.description?.toLowerCase().includes(q) ?? false;
  return nameMatch || descMatch;
}

export function matchesTags(game: CatalogGame, activeTags: ReadonlySet<string>): boolean {
  if (activeTags.size === 0) return true;
  const gameTags = game.tags ?? [];
  return gameTags.some((tag) => activeTags.has(tag));
}

/**
 * Whether `game` can be played by the selected player count. An "or more"
 * option (the "5+" chip) only requires the game's maximum to reach the value,
 * so 6–8 player games are included rather than excluded by their minimum.
 */
export function matchesPlayerCount(game: CatalogGame, option: PlayerCountOption | null): boolean {
  if (option === null) return true;
  if (option.orMore) return game.players.max >= option.value;
  return game.players.min <= option.value && game.players.max >= option.value;
}

export function matchesCategory(
  game: CatalogGame,
  categoryTags: readonly string[] | null,
): boolean {
  if (categoryTags === null) return true;
  const gameTags = game.tags ?? [];
  return categoryTags.some((ct) => gameTags.includes(ct));
}

export function extractUniqueTags(games: readonly CatalogGame[]): readonly string[] {
  return [...new Set(games.flatMap((g) => g.tags ?? []))];
}

// ─── Combined filter ───────────────────────────────────────────────

export interface CatalogFilterState {
  readonly searchQuery: string;
  readonly activeTags: ReadonlySet<string>;
  readonly playerCount: PlayerCountOption | null;
  readonly categoryIndex: number;
}

/** True when the user has narrowed the list with search, tags or player count. */
export function hasManualFilters(filters: CatalogFilterState): boolean {
  return (
    filters.searchQuery.trim() !== "" || filters.activeTags.size > 0 || filters.playerCount !== null
  );
}

/**
 * Applies the filters. Manual filters (search/tags/players) take precedence
 * over the category tabs: when any is active the category is ignored.
 */
export function filterGames(
  games: readonly CatalogGame[],
  filters: CatalogFilterState,
): readonly CatalogGame[] {
  if (hasManualFilters(filters)) {
    return games.filter(
      (g) =>
        matchesSearch(g, filters.searchQuery) &&
        matchesTags(g, filters.activeTags) &&
        matchesPlayerCount(g, filters.playerCount),
    );
  }
  const category = CATEGORIES[filters.categoryIndex] ?? CATEGORIES[0]!;
  return games.filter((g) => matchesCategory(g, category.tags));
}
