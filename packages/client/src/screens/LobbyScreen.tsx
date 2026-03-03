// ─── Lobby Screen ──────────────────────────────────────────────────
// Shows the player's lobby status and lets them browse, install, and
// select games while waiting for the host to start.

import React, { useCallback, useState } from "react";
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

// ─── Types ─────────────────────────────────────────────────────────

interface LobbyScreenProps {
  readonly state: HostGameState;
  readonly sendAction: (action: HostAction) => void;
  readonly playerId: string;
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

const selectedGameStyle: CSSProperties = {
  padding: "0 16px 12px",
  flexShrink: 0,
};

const selectedLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
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

const centeredStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
  gap: 12,
};

const mutedTextStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--color-text-muted)",
};

const spinnerStyle: CSSProperties = {
  fontSize: 24,
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

const retryButtonStyle: CSSProperties = {
  padding: "8px 20px",
  border: "none",
  borderRadius: 999,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

// ─── Component ─────────────────────────────────────────────────────

export function LobbyScreen({
  state,
  sendAction,
  playerId,
}: LobbyScreenProps): React.JSX.Element {
  const { catalog, refetch } = useCatalog();
  const [installError, setInstallError] = useState<string | null>(null);

  const player = state.players[playerId];
  const playerName = player?.name ?? "Player";

  // Currently selected game slug (from lobby screen state)
  const selectedSlug =
    state.screen.tag === "lobby"
      ? state.screen.ruleset.meta.slug
      : null;

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

  const handleSelect = useCallback(
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
          type: "SELECT_RULESET",
          ruleset: result.data as CardGameRuleset,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Selection failed";
        setInstallError(`Could not select ${game.name}: ${message}`);
      }
    },
    [sendAction],
  );

  return (
    <div style={containerStyle}>
      {/* ── Lobby header ───────────────────────────────────────── */}
      <div style={headerStyle}>
        <p style={labelStyle}>You joined as</p>
        <p style={nameStyle}>{playerName}</p>
        <p style={waitingStyle}>Waiting for host to start the game...</p>
      </div>

      {installError !== null && (
        <div style={errorBannerStyle}>{installError}</div>
      )}

      {/* ── Currently selected game ────────────────────────────── */}
      {selectedSlug !== null &&
        catalog.tag === "loaded" &&
        (() => {
          const selectedGame = catalog.games.find(
            (g) => g.slug === selectedSlug,
          );
          if (!selectedGame) return null;

          const installed = state.installedSlugs.find(
            (ig) => ig.slug === selectedGame.slug,
          );

          return (
            <div style={selectedGameStyle}>
              <p style={selectedLabelStyle}>Selected Game</p>
              <GameCard
                game={selectedGame}
                isInstalled={installed !== undefined}
                isPending={state.pendingInstall?.slug === selectedGame.slug}
                isSelected={true}
                onSelect={() => {}}
                onInstall={(g) => void handleInstall(g)}
              />
            </div>
          );
        })()}

      <div style={dividerStyle} />

      {/* ── Catalog browser ────────────────────────────────────── */}
      <div style={catalogSectionStyle}>
        <h2 style={catalogHeaderStyle}>Browse Games</h2>

        {catalog.tag === "loading" && (
          <div style={centeredStyle}>
            <span style={spinnerStyle}>{"\u2660"}</span>
            <p style={mutedTextStyle}>Loading games...</p>
          </div>
        )}

        {catalog.tag === "error" && (
          <div style={centeredStyle}>
            <p style={{ ...mutedTextStyle, color: "var(--color-danger)" }}>
              {catalog.message}
            </p>
            <button
              type="button"
              style={retryButtonStyle}
              onClick={refetch}
            >
              Retry
            </button>
          </div>
        )}

        {catalog.tag === "loaded" && (
          <div style={listStyle}>
            {catalog.games.length === 0 ? (
              <div style={centeredStyle}>
                <p style={mutedTextStyle}>No games available</p>
              </div>
            ) : (
              catalog.games.map((game) => {
                const installed = state.installedSlugs.find(
                  (ig) => ig.slug === game.slug,
                );
                const isInstalled = installed !== undefined;
                const isUpdateAvailable =
                  isInstalled && installed.version !== game.version;
                const isSelected = game.slug === selectedSlug;

                return (
                  <GameCard
                    key={game.slug}
                    game={game}
                    isInstalled={isInstalled}
                    isUpdateAvailable={isUpdateAvailable}
                    isPending={state.pendingInstall?.slug === game.slug}
                    isUninstalling={state.pendingUninstall === game.slug}
                    onInstall={(g) => void handleInstall(g)}
                    onUninstall={() =>
                      sendAction({ type: "UNINSTALL_RULESET", slug: game.slug })
                    }
                    onSelect={() => void handleSelect(game)}
                    isSelected={isSelected}
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
