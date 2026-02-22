// ─── Lobby Screen ──────────────────────────────────────────────────
// Waiting room where players scan a QR code to join. Shows connected
// players, the selected game info, and a start button that activates
// once the minimum player count is met.

import React, { useMemo, useState, useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { IPlayer } from "@couch-kit/core";
import type { HostAction, HostGameState } from "../types/host-state";

// TODO: Install react-native-qrcode-skia and replace QR placeholder
// import { QRCode } from "react-native-qrcode-skia";

// ─── Component ─────────────────────────────────────────────────────

export function Lobby(): React.JSX.Element {
  const { state, dispatch, serverUrl } = useGameHost<HostGameState, HostAction>();

  // Guard: this screen only renders when screen.tag === "lobby"
  if (state.screen.tag !== "lobby") {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Invalid screen state</Text>
      </View>
    );
  }

  const { ruleset } = state.screen;
  const { min, max } = ruleset.meta.players;

  const playerList = useMemo(
    () =>
      Object.entries(state.players).map(
        ([id, player]): IPlayer => ({ ...player, id }),
      ),
    [state.players],
  );

  const connectedCount = playerList.filter(
    (p: IPlayer) => p.connected,
  ).length;
  const canStart = connectedCount >= min;

  const handleStart = useCallback(() => {
    if (!canStart) return;
    dispatch({ type: "START_GAME" });
  }, [dispatch, canStart]);

  const handleBack = useCallback(() => {
    dispatch({ type: "BACK_TO_PICKER" });
  }, [dispatch]);

  return (
    <View style={styles.container}>
      {/* Left panel: QR code + connection info */}
      <View style={styles.leftPanel}>
        <QRPlaceholder url={serverUrl} />
        <Text style={styles.gameName}>{ruleset.meta.name}</Text>
        <Text style={styles.connectionHint}>
          Scan to join on your phone
        </Text>
      </View>

      {/* Right panel: player list + controls */}
      <View style={styles.rightPanel}>
        <Text style={styles.playerCountLabel}>
          {connectedCount} / {min}–{max} players
        </Text>

        <ScrollView style={styles.playerList} contentContainerStyle={styles.playerListContent}>
          {playerList.length === 0 ? (
            <Text style={styles.emptyHint}>Waiting for players…</Text>
          ) : (
            playerList.map((player: IPlayer) => (
              <PlayerRow key={player.id} player={player} />
            ))
          )}
        </ScrollView>

        <View style={styles.controls}>
          <LobbyButton
            label="Start Game"
            onPress={handleStart}
            disabled={!canStart}
            isPrimary
            isFirst
          />
          <LobbyButton
            label="Back"
            onPress={handleBack}
            disabled={false}
            isPrimary={false}
            isFirst={false}
          />
        </View>
      </View>
    </View>
  );
}

// ─── QR Placeholder ────────────────────────────────────────────────

function QRPlaceholder({
  url,
}: {
  readonly url: string | null;
}): React.JSX.Element {
  // TODO: Replace with <QRCode value={url} size={220} /> from react-native-qrcode-skia
  return (
    <View style={styles.qrBox}>
      <Text style={styles.qrText}>
        {url ? `QR: ${url}` : "Starting server…"}
      </Text>
    </View>
  );
}

// ─── Player Row ────────────────────────────────────────────────────

function PlayerRow({
  player,
}: {
  readonly player: IPlayer;
}): React.JSX.Element {
  return (
    <View style={styles.playerRow}>
      <View
        style={[
          styles.avatarCircle,
          !player.connected && styles.avatarDisconnected,
        ]}
      >
        <Text style={styles.avatarText}>
          {player.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text
        style={[
          styles.playerName,
          !player.connected && styles.playerNameDisconnected,
        ]}
      >
        {player.name}
      </Text>
      {!player.connected && (
        <Text style={styles.disconnectedBadge}>DISCONNECTED</Text>
      )}
    </View>
  );
}

// ─── Lobby Button ──────────────────────────────────────────────────

function LobbyButton({
  label,
  onPress,
  disabled,
  isPrimary,
  isFirst,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly isPrimary: boolean;
  readonly isFirst: boolean;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      style={[
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        focused && !disabled && styles.buttonFocused,
      ]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={isFirst}
    >
      <Text
        style={[
          styles.buttonLabel,
          isPrimary ? styles.buttonLabelPrimary : styles.buttonLabelSecondary,
          disabled && styles.buttonLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    flexDirection: "row",
    padding: 48,
  },
  errorText: {
    color: "#ff5252",
    fontSize: 28,
    textAlign: "center",
  },

  // Left panel
  leftPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingRight: 32,
  },
  qrBox: {
    width: 240,
    height: 240,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  qrText: {
    color: "#333333",
    fontSize: 16,
    textAlign: "center",
  },
  gameName: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "700",
    marginTop: 28,
    textAlign: "center",
  },
  connectionHint: {
    color: "#888888",
    fontSize: 22,
    marginTop: 12,
    textAlign: "center",
  },

  // Right panel
  rightPanel: {
    flex: 1,
    paddingLeft: 32,
  },
  playerCountLabel: {
    color: "#b0b0b0",
    fontSize: 26,
    fontWeight: "600",
    marginBottom: 20,
  },
  playerList: {
    flex: 1,
  },
  playerListContent: {
    gap: 12,
  },
  emptyHint: {
    color: "#666666",
    fontSize: 24,
    fontStyle: "italic",
    marginTop: 24,
  },

  // Player row
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e1e1e",
    borderRadius: 12,
    padding: 16,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#7c4dff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarDisconnected: {
    backgroundColor: "#555555",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  playerName: {
    color: "#e0e0e0",
    fontSize: 24,
    fontWeight: "500",
    flex: 1,
  },
  playerNameDisconnected: {
    color: "#777777",
  },
  disconnectedBadge: {
    color: "#ff5252",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // Controls
  controls: {
    flexDirection: "row",
    gap: 16,
    marginTop: 24,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 3,
    borderColor: "transparent",
  },
  buttonPrimary: {
    backgroundColor: "#7c4dff",
  },
  buttonSecondary: {
    backgroundColor: "#2a2a2a",
  },
  buttonDisabled: {
    backgroundColor: "#333333",
    opacity: 0.5,
  },
  buttonFocused: {
    borderColor: "#ffffff",
  },
  buttonLabel: {
    fontSize: 24,
    fontWeight: "700",
  },
  buttonLabelPrimary: {
    color: "#ffffff",
  },
  buttonLabelSecondary: {
    color: "#b0b0b0",
  },
  buttonLabelDisabled: {
    color: "#666666",
  },
});
