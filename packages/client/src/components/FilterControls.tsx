// ─── Filter Controls ───────────────────────────────────────────────
// Search box, tag chips, player-count chips and category tabs for the
// catalog browser. Purely presentational over `useCatalogFilters`.

import type React from "react";
import { CATEGORIES, PLAYER_COUNTS } from "../lib/catalog-filters.js";
import type { CatalogFilters } from "../hooks/useCatalogFilters.js";
import {
  categoryRowStyle,
  categoryTabStyle,
  chipRowStyle,
  chipStyle,
  controlsStyle,
  filteredLabelStyle,
  playerChipStyle,
  playerFilterRowStyle,
  playerLabelStyle,
  searchInputStyle,
  sectionDividerStyle,
} from "../screens/CatalogScreen.styles.js";

interface FilterControlsProps {
  readonly model: CatalogFilters;
}

export function FilterControls({ model }: FilterControlsProps): React.JSX.Element {
  const { filters, hasManualFilters, allTags } = model;

  return (
    <div style={controlsStyle}>
      <input
        type="search"
        placeholder="Search games..."
        aria-label="Search games"
        value={filters.searchQuery}
        onChange={(e) => model.setSearch(e.target.value)}
        style={searchInputStyle}
      />

      {allTags.length > 0 && (
        <div style={chipRowStyle}>
          <button
            type="button"
            style={chipStyle(filters.activeTags.size === 0)}
            aria-pressed={filters.activeTags.size === 0}
            onClick={model.clearTags}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              style={chipStyle(filters.activeTags.has(tag))}
              aria-pressed={filters.activeTags.has(tag)}
              onClick={() => model.toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <fieldset style={playerFilterRowStyle} aria-labelledby="catalog-players-label">
        <span id="catalog-players-label" style={playerLabelStyle}>
          Players:
        </span>
        {PLAYER_COUNTS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            style={playerChipStyle(filters.playerCount?.value === value)}
            aria-pressed={filters.playerCount?.value === value}
            onClick={() => model.togglePlayerCount(value)}
          >
            {label}
          </button>
        ))}
      </fieldset>

      {/* Category tabs — only meaningful when no manual filters are active */}
      <div style={categoryRowStyle}>
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.name}
            type="button"
            style={categoryTabStyle(!hasManualFilters && filters.categoryIndex === i)}
            aria-pressed={!hasManualFilters && filters.categoryIndex === i}
            onClick={() => model.selectCategory(i)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      <div style={sectionDividerStyle} />

      {hasManualFilters && <span style={filteredLabelStyle}>Filtered Results</span>}
    </div>
  );
}
