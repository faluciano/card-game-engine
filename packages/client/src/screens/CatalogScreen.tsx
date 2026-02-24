// ─── Catalog Screen ────────────────────────────────────────────────
// Browse and install games from the remote catalog.
// Replaces the WaitingScreen when status === "ruleset_picker".

import React, { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CatalogGame,
  CardGameRuleset,
  HostGameState,
  HostAction,
} from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";
import { useCatalog } from "../hooks/useCatalog.js";
import { GameCard } from "../components/GameCard.js";

const CATALOG_BASE_URL =
  "https://faluciano.github.io/card-game-engine/";

// ─── Categories ────────────────────────────────────────────────────

const CATEGORIES = [
  { name: "All Games", tags: null },
  { name: "Classic", tags: ["classic"] },
  { name: "Family Friendly", tags: ["family", "kids", "simple"] },
  { name: "Card Shedding", tags: ["shedding", "matching"] },
  { name: "Casino", tags: ["casino", "banking"] },
] as const;

// ─── Types ─────────────────────────────────────────────────────────

interface CatalogScreenProps {
  readonly state: HostGameState;
  readonly sendAction: (action: HostAction) => void;
}

// ─── Pure filter helpers ───────────────────────────────────────────

function matchesSearch(game: CatalogGame, query: string): boolean {
  if (query === "") return true;
  const q = query.toLowerCase();
  const nameMatch = game.name.toLowerCase().includes(q);
  const descMatch =
    game.description !== undefined &&
    game.description.toLowerCase().includes(q);
  return nameMatch || descMatch;
}

function matchesTags(game: CatalogGame, activeTags: ReadonlySet<string>): boolean {
  if (activeTags.size === 0) return true;
  const gameTags = game.tags ?? [];
  return gameTags.some((tag) => activeTags.has(tag));
}

function matchesPlayerCount(game: CatalogGame, playerCount: number | null): boolean {
  if (playerCount === null) return true;
  return game.players.min <= playerCount && game.players.max >= playerCount;
}

function matchesCategory(
  game: CatalogGame,
  categoryTags: readonly string[] | null,
): boolean {
  if (categoryTags === null) return true;
  const gameTags = game.tags ?? [];
  return categoryTags.some((ct) => gameTags.includes(ct));
}

function extractUniqueTags(games: readonly CatalogGame[]): readonly string[] {
  return [...new Set(games.flatMap((g) => g.tags ?? []))];
}

// ─── Styles ────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  animation: "fadeIn 0.3s ease-out",
};

const headerStyle: CSSProperties = {
  padding: "20px 16px 12px",
  fontSize: 24,
  fontWeight: 700,
  color: "var(--color-text)",
};

const controlsStyle: CSSProperties = {
  padding: "0 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flexShrink: 0,
};

const searchInputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid transparent",
  borderRadius: "var(--radius-md)",
  fontSize: 15,
  outline: "none",
};

const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  paddingBottom: 4,
  scrollbarWidth: "none",
};

const chipBaseStyle: CSSProperties = {
  flexShrink: 0,
  padding: "6px 14px",
  border: "none",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background-color 0.15s, color 0.15s",
};

const playerFilterRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const playerLabelStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-muted)",
  fontWeight: 500,
  flexShrink: 0,
};

const categoryRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  overflowX: "auto",
  paddingBottom: 4,
  scrollbarWidth: "none",
};

const categoryBaseStyle: CSSProperties = {
  flexShrink: 0,
  padding: "6px 12px",
  border: "none",
  borderRadius: "var(--radius-md)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  transition: "background-color 0.15s, color 0.15s",
};

const sectionDividerStyle: CSSProperties = {
  height: 1,
  backgroundColor: "var(--color-surface-raised)",
  margin: "6px 0 2px",
  opacity: 0.5,
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const centeredStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
  gap: 16,
};

const mutedTextStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--color-text-muted)",
};

const errorTextStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--color-danger)",
};

const retryButtonStyle: CSSProperties = {
  padding: "10px 24px",
  border: "none",
  borderRadius: 999,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const spinnerStyle: CSSProperties = {
  fontSize: 32,
  animation: "spin 1s linear infinite",
};

const errorBannerStyle: CSSProperties = {
  margin: "0 16px 12px",
  padding: "10px 14px",
  borderRadius: 8,
  backgroundColor: "rgba(220, 53, 69, 0.15)",
  color: "var(--color-danger)",
  fontSize: 13,
  textAlign: "center",
};

const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "40px 16px",
  textAlign: "center",
};

const clearFiltersButtonStyle: CSSProperties = {
  padding: "8px 20px",
  border: "none",
  borderRadius: 999,
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const filteredLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "2px 0",
};

// ─── Style helpers ─────────────────────────────────────────────────

function chipStyle(active: boolean): CSSProperties {
  return {
    ...chipBaseStyle,
    backgroundColor: active ? "var(--color-accent)" : "var(--color-surface)",
    color: active ? "#fff" : "var(--color-text-muted)",
  };
}

function categoryTabStyle(active: boolean): CSSProperties {
  return {
    ...categoryBaseStyle,
    backgroundColor: active ? "var(--color-accent)" : "var(--color-surface)",
    color: active ? "#fff" : "var(--color-text-muted)",
  };
}

function playerChipStyle(active: boolean): CSSProperties {
  return {
    ...chipBaseStyle,
    padding: "6px 12px",
    fontSize: 12,
    backgroundColor: active ? "var(--color-accent)" : "var(--color-surface)",
    color: active ? "#fff" : "var(--color-text-muted)",
  };
}

// ─── Player count options ──────────────────────────────────────────

const PLAYER_COUNTS: readonly { readonly label: string; readonly value: number }[] = [
  { label: "2P", value: 2 },
  { label: "3P", value: 3 },
  { label: "4P", value: 4 },
  { label: "5+", value: 5 },
];

// ─── Component ─────────────────────────────────────────────────────

export function CatalogScreen({
  state,
  sendAction,
}: CatalogScreenProps): React.JSX.Element {
  const catalog = useCatalog();
  const [installError, setInstallError] = useState<string | null>(null);

  // ── Filter state ───────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [categoryIndex, setCategoryIndex] = useState<number>(0);

  const handleInstall = useCallback(
    async (game: CatalogGame): Promise<void> => {
      setInstallError(null);

      try {
        const url = `${CATALOG_BASE_URL}${game.file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download: HTTP ${res.status}`);

        const raw: unknown = await res.json();
        const result = safeParseRuleset(raw);

        if (!result.success) {
          throw new Error("Invalid ruleset format");
        }

        sendAction({
          type: "INSTALL_RULESET",
          ruleset: result.data as CardGameRuleset,
          slug: game.slug,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Installation failed";
        setInstallError(`Could not install ${game.name}: ${message}`);
      }
    },
    [sendAction],
  );

  const clearAllFilters = useCallback((): void => {
    setSearchQuery("");
    setActiveTags(new Set());
    setPlayerCount(null);
    setCategoryIndex(0);
  }, []);

  const clearTags = useCallback((): void => {
    setActiveTags(new Set());
  }, []);

  const toggleTag = useCallback((tag: string): void => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const togglePlayerCount = useCallback((value: number): void => {
    setPlayerCount((prev) => (prev === value ? null : value));
  }, []);

  // ── Loading state ──
  if (catalog.tag === "loading") {
    return (
      <div style={centeredStyle}>
        <span style={spinnerStyle}>{"\u2660"}</span>
        <p style={mutedTextStyle}>Loading games...</p>
      </div>
    );
  }

  // ── Error state ──
  if (catalog.tag === "error") {
    return (
      <div style={centeredStyle}>
        <p style={errorTextStyle}>{catalog.message}</p>
        <button
          type="button"
          style={retryButtonStyle}
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Loaded state ──
  const { games } = catalog;

  return (
    <CatalogLoaded
      games={games}
      state={state}
      installError={installError}
      searchQuery={searchQuery}
      activeTags={activeTags}
      playerCount={playerCount}
      categoryIndex={categoryIndex}
      onSearchChange={setSearchQuery}
      onToggleTag={toggleTag}
      onClearTags={clearTags}
      onTogglePlayerCount={togglePlayerCount}
      onCategoryChange={setCategoryIndex}
      onClearFilters={clearAllFilters}
      onInstall={(g) => void handleInstall(g)}
      onUninstall={(slug) =>
        sendAction({ type: "UNINSTALL_RULESET", slug })
      }
    />
  );
}

// ─── Loaded sub-component ──────────────────────────────────────────
// Extracted so hooks (useMemo) can run unconditionally.

interface CatalogLoadedProps {
  readonly games: readonly CatalogGame[];
  readonly state: HostGameState;
  readonly installError: string | null;
  readonly searchQuery: string;
  readonly activeTags: ReadonlySet<string>;
  readonly playerCount: number | null;
  readonly categoryIndex: number;
  readonly onSearchChange: (query: string) => void;
  readonly onToggleTag: (tag: string) => void;
  readonly onClearTags: () => void;
  readonly onTogglePlayerCount: (value: number) => void;
  readonly onCategoryChange: (index: number) => void;
  readonly onClearFilters: () => void;
  readonly onInstall: (game: CatalogGame) => void;
  readonly onUninstall: (slug: string) => void;
}

function CatalogLoaded({
  games,
  state,
  installError,
  searchQuery,
  activeTags,
  playerCount,
  categoryIndex,
  onSearchChange,
  onToggleTag,
  onClearTags,
  onTogglePlayerCount,
  onCategoryChange,
  onClearFilters,
  onInstall,
  onUninstall,
}: CatalogLoadedProps): React.JSX.Element {
  const allTags = useMemo(() => extractUniqueTags(games), [games]);

  const hasManualFilters =
    searchQuery !== "" || activeTags.size > 0 || playerCount !== null;

  const filteredGames = useMemo(() => {
    // When manual filters are active, category is ignored
    if (hasManualFilters) {
      return games.filter(
        (g) =>
          matchesSearch(g, searchQuery) &&
          matchesTags(g, activeTags) &&
          matchesPlayerCount(g, playerCount),
      );
    }

    // Otherwise, apply category filter
    const category = CATEGORIES[categoryIndex];
    return games.filter((g) => matchesCategory(g, category.tags));
  }, [games, searchQuery, activeTags, playerCount, hasManualFilters, categoryIndex]);

  return (
    <div style={containerStyle}>
      <h1 style={headerStyle}>Browse Games</h1>

      {installError !== null && (
        <div style={errorBannerStyle}>{installError}</div>
      )}

      {/* ── Filter controls ──────────────────────────────────────── */}
      <div style={controlsStyle}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search games..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={searchInputStyle}
        />

        {/* Tag chips */}
        {allTags.length > 0 && (
          <div style={chipRowStyle}>
            <button
              type="button"
              style={chipStyle(activeTags.size === 0)}
              onClick={onClearTags}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                style={chipStyle(activeTags.has(tag))}
                onClick={() => onToggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Player count filter */}
        <div style={playerFilterRowStyle}>
          <span style={playerLabelStyle}>Players:</span>
          {PLAYER_COUNTS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              style={playerChipStyle(playerCount === value)}
              onClick={() => onTogglePlayerCount(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Category tabs — only meaningful when no manual filters */}
        <div style={categoryRowStyle}>
          {CATEGORIES.map((cat, i) => (
            <button
              key={cat.name}
              type="button"
              style={categoryTabStyle(!hasManualFilters && categoryIndex === i)}
              onClick={() => {
                onClearFilters();
                onCategoryChange(i);
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div style={sectionDividerStyle} />

        {/* Active filter label */}
        {hasManualFilters && (
          <span style={filteredLabelStyle}>Filtered Results</span>
        )}
      </div>

      {/* ── Game list ────────────────────────────────────────────── */}
      <div style={listStyle}>
        {filteredGames.length === 0 ? (
          <div style={emptyStateStyle}>
            <p style={mutedTextStyle}>No games match your filters</p>
            <button
              type="button"
              style={clearFiltersButtonStyle}
              onClick={onClearFilters}
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredGames.map((game) => {
            const installed = state.installedSlugs.find(
              (ig) => ig.slug === game.slug,
            );
            const isInstalled = installed !== undefined;
            const isUpdateAvailable =
              isInstalled && installed.version !== game.version;

            return (
              <GameCard
                key={game.slug}
                game={game}
                isInstalled={isInstalled}
                isUpdateAvailable={isUpdateAvailable}
                isPending={state.pendingInstall?.slug === game.slug}
                isUninstalling={state.pendingUninstall === game.slug}
                onInstall={onInstall}
                onUninstall={() => onUninstall(game.slug)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
