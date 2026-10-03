// ─── Lobby Screen ──────────────────────────────────────────────────
// Shows the player's lobby status and lets them browse, install, and
// select games while waiting for the host to start.

import type React from "react";
import type { CSSProperties } from "react";
import type { CatalogGame, HostAction, HostClientView } from "@card-engine/shared";
import { findInstalledVersion, isBuiltInSlug } from "@card-engine/host-core/catalog";
import { useClientCatalog } from "../hooks/useClientCatalog.js";
import { useCatalogInstaller } from "../hooks/useCatalogInstaller.js";
import { GameCard } from "../components/GameCard.js";
import { CenteredState } from "../components/CenteredState.js";
import { SelectedGame } from "../components/SelectedGame.js";

// ─── Types ─────────────────────────────────────────────────────────

interface LobbyScreenProps {
  readonly state: HostClientView;
  readonly sendAction: (action: HostAction) => void;
  readonly playerId: string;
  readonly onChangeName?: () => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  animation: "fadeIn 0.3s ease-out",
};

const headerStyle: CSSProperties = {
  padding: "20px 16px 16px",
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const nameStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
};

const waitingStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--color-text-muted)",
  animation: "pulse 1.5s ease-in-out infinite",
};

const dividerStyle: CSSProperties = {
  height: 1,
  backgroundColor: "var(--color-surface-raised)",
  margin: "0 16px",
  opacity: 0.5,
  flexShrink: 0,
};

const catalogSectionStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const catalogHeaderStyle: CSSProperties = {
  padding: "12px 16px 8px",
  fontSize: 18,
  fontWeight: 700,
  color: "var(--color-text)",
  flexShrink: 0,
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 16px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const errorBannerStyle: CSSProperties = {
  margin: "0 16px 12px",
  padding: "10px 14px",
  borderRadius: "var(--radius-sm)",
  backgroundColor: "rgba(220, 53, 69, 0.15)",
  color: "var(--color-danger)",
  fontSize: 13,
  textAlign: "center",
};

const changeNameButtonStyle: CSSProperties = {
  padding: "4px 12px",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-pill)",
  backgroundColor: "transparent",
  color: "var(--color-text-muted)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  transition: "border-color 0.2s ease",
};

// ─── Component ─────────────────────────────────────────────────────

export function LobbyScreen({
  state,
  sendAction,
  playerId,
  onChangeName,
}: LobbyScreenProps): React.JSX.Element {
  const { catalog, refetch } = useClientCatalog();
  const installer = useCatalogInstaller(sendAction);

  const playerName = state.players[playerId]?.name ?? "Player";

  // Currently selected game slug (from lobby screen state)
  const selectedSlug = state.screen.tag === "lobby" ? state.screen.ruleset.slug : null;
  const selectedGame =
    selectedSlug !== null && catalog.tag === "loaded"
      ? (catalog.games.find((g) => g.slug === selectedSlug) ?? null)
      : null;

  const isPending = (game: CatalogGame): boolean =>
    state.pendingInstall?.slug === game.slug || installer.inFlight.has(game.slug);

  return (
    <div style={containerStyle}>
      {/* ── Lobby header ───────────────────────────────────────── */}
      <div style={headerStyle}>
        <p style={labelStyle}>You joined as</p>
        <p style={nameStyle}>{playerName}</p>
        {onChangeName != null && (
          <button type="button" style={changeNameButtonStyle} onClick={onChangeName}>
            Change name
          </button>
        )}
        <p style={waitingStyle}>Waiting for host to start the game...</p>
      </div>

      {installer.error !== null && (
        <div role="alert" style={errorBannerStyle}>
          {installer.error}
        </div>
      )}

      {selectedGame !== null && (
        <SelectedGame
          game={selectedGame}
          installedVersion={findInstalledVersion(state.installedSlugs, selectedGame.slug)}
          isBuiltIn={isBuiltInSlug(selectedGame.slug)}
          isPending={isPending(selectedGame)}
          onInstall={installer.install}
        />
      )}

      <div style={dividerStyle} />

      {/* ── Catalog browser ────────────────────────────────────── */}
      <div style={catalogSectionStyle}>
        <h2 style={catalogHeaderStyle}>Browse Games</h2>

        {catalog.tag === "loading" && <CenteredState message="Loading games..." spinner />}

        {catalog.tag === "error" && (
          <CenteredState
            message={catalog.message}
            tone="danger"
            action={{ label: "Retry", onClick: refetch }}
          />
        )}

        {catalog.tag === "loaded" && (
          <div style={listStyle}>
            {catalog.games.length === 0 ? (
              <CenteredState message="No games available" />
            ) : (
              catalog.games.map((game) => (
                <GameCard
                  key={game.slug}
                  game={game}
                  installedVersion={findInstalledVersion(state.installedSlugs, game.slug)}
                  isBuiltIn={isBuiltInSlug(game.slug)}
                  isPending={isPending(game)}
                  isUninstalling={state.pendingUninstall === game.slug}
                  onInstall={installer.install}
                  onUninstall={() => installer.uninstall(game.slug)}
                  onSelect={() => installer.select(game)}
                  isSelected={game.slug === selectedSlug}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
