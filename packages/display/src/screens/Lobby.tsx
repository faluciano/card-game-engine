// ─── Lobby Screen (web) ────────────────────────────────────────────
// Web port of packages/host/src/screens/Lobby.tsx. Waiting room where
// players scan a QR to join over the relay. Shows the connected players,
// the selected game, and a start button that unlocks at the minimum
// player count.

import React, { useMemo } from "react";
import type { IPlayer } from "@couch-kit/core";
import type { HostAction, HostGameState } from "@card-engine/shared";
import { Button } from "../components/Button.js";
import { JoinPanel } from "../components/JoinPanel.js";
import { colors } from "../theme.js";

export function Lobby({
  state,
  dispatch,
  joinUrl,
  roomId,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
  readonly joinUrl: string | null;
  readonly roomId: string;
}): React.JSX.Element {
  const screen = state.screen;

  const playerList = useMemo(
    () =>
      Object.entries(state.players).map(
        ([id, player]): IPlayer => ({ ...player, id }),
      ),
    [state.players],
  );

  // Guard: this screen only renders when screen.tag === "lobby"
  if (screen.tag !== "lobby") {
    return (
      <div style={styles.container}>
        <div style={styles.errorText}>Invalid screen state</div>
      </div>
    );
  }

  const { ruleset } = screen;
  const { min, max } = ruleset.meta.players;

  const connectedCount = playerList.filter((p) => p.connected).length;
  const canStart = connectedCount >= min;

  return (
    <div style={styles.container}>
      {/* Left panel: QR code + connection info */}
      <div style={styles.leftPanel}>
        <JoinPanel joinUrl={joinUrl} roomId={roomId} size={220} />
        <div style={styles.gameName}>{ruleset.meta.name}</div>
        <div style={styles.connectionHint}>Scan to join on your phone</div>
      </div>

      {/* Right panel: player list + controls */}
      <div style={styles.rightPanel}>
        <div style={styles.playerCountLabel}>
          {connectedCount} / {min}–{max} players
        </div>

        <div style={styles.playerList}>
          {playerList.length === 0 ? (
            <div style={styles.emptyHint}>Waiting for players…</div>
          ) : (
            playerList.map((player) => (
              <PlayerRow key={player.id} player={player} />
            ))
          )}
        </div>

        <div style={styles.controls}>
          <Button
            label="Start Game"
            variant="primary"
            disabled={!canStart}
            onPress={() => dispatch({ type: "START_GAME" })}
            style={styles.controlButton}
          />
          <Button
            label="Back"
            variant="secondary"
            onPress={() => dispatch({ type: "BACK_TO_PICKER" })}
            style={styles.controlButton}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Player Row ────────────────────────────────────────────────────

const PlayerRow = React.memo(function PlayerRow({
  player,
}: {
  readonly player: IPlayer;
}): React.JSX.Element {
  return (
    <div style={styles.playerRow}>
      <div
        style={{
          ...styles.avatarCircle,
          ...(player.connected ? null : styles.avatarDisconnected),
        }}
      >
        <span style={styles.avatarText}>
          {player.name.charAt(0).toUpperCase()}
        </span>
      </div>
      <span
        style={{
          ...styles.playerName,
          ...(player.connected ? null : styles.playerNameDisconnected),
        }}
      >
        {player.name}
      </span>
      {!player.connected && (
        <span style={styles.disconnectedBadge}>DISCONNECTED</span>
      )}
    </div>
  );
});

// ─── Styles ────────────────────────────────────────────────────────

const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "row",
    backgroundColor: colors.bg,
    padding: 48,
    minHeight: 0,
    boxSizing: "border-box",
  },
  errorText: {
    color: colors.danger,
    fontSize: 28,
    textAlign: "center",
    margin: "auto",
  },

  // Left panel
  leftPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 32,
  },
  gameName: {
    color: colors.textBright,
    fontSize: 36,
    fontWeight: 700,
    marginTop: 28,
    textAlign: "center",
  },
  connectionHint: {
    color: colors.textDim,
    fontSize: 22,
    marginTop: 12,
    textAlign: "center",
  },

  // Right panel
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    paddingLeft: 32,
    minHeight: 0,
  },
  playerCountLabel: {
    color: colors.textMuted,
    fontSize: 26,
    fontWeight: 600,
    marginBottom: 20,
  },
  playerList: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    minHeight: 0,
  },
  emptyHint: {
    color: colors.textFaint,
    fontSize: 24,
    fontStyle: "italic",
    marginTop: 24,
  },

  // Player row
  playerRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    flexShrink: 0,
  },
  avatarCircle: {
    display: "flex",
    width: 48,
    height: 48,
    borderRadius: "50%",
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
    flexShrink: 0,
  },
  avatarDisconnected: {
    backgroundColor: colors.disabled,
  },
  avatarText: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: 700,
  },
  playerName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 500,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  playerNameDisconnected: {
    color: colors.textDim,
  },
  disconnectedBadge: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 1,
  },

  // Controls
  controls: {
    display: "flex",
    flexDirection: "row",
    gap: 16,
    marginTop: 24,
  },
  controlButton: {
    flex: 1,
    paddingTop: 18,
    paddingBottom: 18,
  },
} satisfies Record<string, React.CSSProperties>;
