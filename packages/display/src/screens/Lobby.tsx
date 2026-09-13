// ─── Lobby Screen (web) ────────────────────────────────────────────
// Thin DOM renderer over `useLobbyModel` from host-core, mirroring
// packages/host/src/screens/Lobby.tsx. Waiting room where players scan
// a QR to join over the relay: connected players, the selected game,
// and a start button that unlocks at the minimum player count.

import React from "react";
import type { HostAction, HostGameState } from "@card-engine/shared";
import { colors, playerInitial, useLobbyModel, type LobbyPlayer } from "@card-engine/host-core";
import { Button } from "../components/Button.js";
import { JoinPanel } from "../components/JoinPanel.js";

export function Lobby({
  state,
  dispatch,
  joinUrl,
  roomId,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
  readonly joinUrl: string | null;
  readonly roomId: string | null;
}): React.JSX.Element {
  const model = useLobbyModel(state, dispatch);

  // Guard: this screen only renders when screen.tag === "lobby"
  if (model.kind !== "lobby") {
    return (
      <div style={styles.container}>
        <div style={styles.errorText}>{model.message}</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Left panel: QR code + connection info */}
      <div style={styles.leftPanel}>
        <JoinPanel joinUrl={joinUrl} roomId={roomId} size={220} />
        <div style={styles.gameName}>{model.gameName}</div>
        <div style={styles.connectionHint}>Scan to join on your phone</div>
      </div>

      {/* Right panel: player list + controls */}
      <div style={styles.rightPanel}>
        <div style={styles.playerCountLabel}>{model.playerCountLabel}</div>

        <div style={styles.playerList}>
          {model.playerList.length === 0 ? (
            <div style={styles.emptyHint}>Waiting for players…</div>
          ) : (
            model.playerList.map((player) => <PlayerRow key={player.id} player={player} />)
          )}
        </div>

        <div style={styles.controls}>
          <Button
            label="Start Game"
            variant="primary"
            disabled={!model.canStart}
            onPress={model.start}
            style={styles.controlButton}
          />
          <Button
            label="Back"
            variant="secondary"
            onPress={model.back}
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
  readonly player: LobbyPlayer;
}): React.JSX.Element {
  return (
    <div style={styles.playerRow}>
      <div
        style={{
          ...styles.avatarCircle,
          ...(player.connected ? null : styles.avatarDisconnected),
        }}
      >
        <span style={styles.avatarText}>{playerInitial(player)}</span>
      </div>
      <span
        style={{
          ...styles.playerName,
          ...(player.connected ? null : styles.playerNameDisconnected),
        }}
      >
        {player.name}
      </span>
      {!player.connected && <span style={styles.disconnectedBadge}>DISCONNECTED</span>}
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
