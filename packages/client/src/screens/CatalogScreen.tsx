// ─── Catalog Screen ────────────────────────────────────────────────
// Browse and install games from the remote catalog.
// Replaces the WaitingScreen when status === "ruleset_picker".

import type React from "react";
import type { CatalogGame, HostAction, HostClientView } from "@card-engine/shared";
import { findInstalledVersion, isBuiltInSlug } from "@card-engine/host-core/catalog";
import { useClientCatalog } from "../hooks/useClientCatalog.js";
import { useCatalogFilters } from "../hooks/useCatalogFilters.js";
import { useCatalogInstaller, type CatalogInstaller } from "../hooks/useCatalogInstaller.js";
import { GameCard } from "../components/GameCard.js";
import { CenteredState } from "../components/CenteredState.js";
import { FilterControls } from "../components/FilterControls.js";
import {
  clearFiltersButtonStyle,
  containerStyle,
  emptyStateStyle,
  errorBannerStyle,
  headerStyle,
  listStyle,
  mutedTextStyle,
  staleBannerStyle,
} from "./CatalogScreen.styles.js";

// ─── Types ─────────────────────────────────────────────────────────

interface CatalogScreenProps {
  readonly state: HostClientView;
  readonly sendAction: (action: HostAction) => void;
}

// ─── Component ─────────────────────────────────────────────────────

export function CatalogScreen({ state, sendAction }: CatalogScreenProps): React.JSX.Element {
  const { catalog, refetch } = useClientCatalog();
  const installer = useCatalogInstaller(sendAction);

  if (catalog.tag === "loading") {
    return <CenteredState message="Loading games..." spinner />;
  }

  if (catalog.tag === "error") {
    return (
      <CenteredState
        message={catalog.message}
        tone="danger"
        action={{ label: "Retry", onClick: refetch }}
      />
    );
  }

  return (
    <CatalogLoaded
      games={catalog.games}
      stale={catalog.stale}
      state={state}
      installer={installer}
    />
  );
}

// ─── Loaded sub-component ──────────────────────────────────────────
// Extracted so the filter hook runs unconditionally.

interface CatalogLoadedProps {
  readonly games: readonly CatalogGame[];
  readonly stale: boolean;
  readonly state: HostClientView;
  readonly installer: CatalogInstaller;
}

function CatalogLoaded({ games, stale, state, installer }: CatalogLoadedProps): React.JSX.Element {
  const filters = useCatalogFilters(games);

  return (
    <div style={containerStyle}>
      <h1 style={headerStyle}>Browse Games</h1>

      {stale && <div style={staleBannerStyle}>Showing cached results</div>}

      {installer.error !== null && (
        <div role="alert" style={errorBannerStyle}>
          {installer.error}
        </div>
      )}

      <FilterControls model={filters} />

      <div style={listStyle}>
        {filters.filteredGames.length === 0 ? (
          <div style={emptyStateStyle}>
            <p style={mutedTextStyle}>No games match your filters</p>
            <button type="button" style={clearFiltersButtonStyle} onClick={filters.clearAll}>
              Clear filters
            </button>
          </div>
        ) : (
          filters.filteredGames.map((game) => (
            <GameCard
              key={game.slug}
              game={game}
              installedVersion={findInstalledVersion(state.installedSlugs, game.slug)}
              isBuiltIn={isBuiltInSlug(game.slug)}
              isPending={
                state.pendingInstall?.slug === game.slug || installer.inFlight.has(game.slug)
              }
              isUninstalling={state.pendingUninstall === game.slug}
              onInstall={installer.install}
              onUninstall={() => installer.uninstall(game.slug)}
            />
          ))
        )}
      </div>
    </div>
  );
}
