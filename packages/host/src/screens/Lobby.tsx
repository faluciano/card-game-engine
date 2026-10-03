// ─── Lobby Screen ──────────────────────────────────────────────────
// Waiting room where players scan a QR code to join. A thin RN renderer
// over `useLobbyModel` from host-core: connected players, the selected
// game info, and a start button that activates once the minimum player
// count is met.

import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { HostAction, HostGameState } from "@card-engine/shared";
import { colors, playerInitial, useLobbyModel, type LobbyPlayer } from "@card-engine/host-core";

import { QRDisplay } from "../components/QRDisplay";
import { TVPressable } from "../components/TVPressable";

// ─── Component ─────────────────────────────────────────────────────

export function Lobby(): React.JSX.Element {
  const { state, dispatch, serverUrl } = useGameHost<HostGameState, HostAction>();
  // All hooks run unconditionally, before the screen-tag guard below.
  const model = useLobbyModel(state, dispatch);

  // Guard: this screen only renders when screen.tag === "lobby"
  if (model.kind !== "lobby") {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{model.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Left panel: QR code + connection info */}
      <View style={styles.leftPanel}>
        <QRDisplay url={serverUrl} />
        <Text style={styles.gameName}>{model.gameName}</Text>
        <Text style={styles.connectionHint}>Scan to join on your phone</Text>
      </View>

      {/* Right panel: player list + controls */}
      <View style={styles.rightPanel}>
        <Text style={styles.playerCountLabel}>{model.playerCountLabel}</Text>

        <ScrollView style={styles.playerList} contentContainerStyle={styles.playerListContent}>
          {model.playerList.length === 0 ? (
            <Text style={styles.emptyHint}>Waiting for players…</Text>
          ) : (
            model.playerList.map((player) => <PlayerRow key={player.id} player={player} />)
          )}
        </ScrollView>

        <View style={styles.controls}>
          {/* A disabled control can't take D-pad focus, so prefer Back until
              enough players have joined, then hand focus to Start the moment
              it unlocks (hasTVPreferredFocus re-requests focus when it flips). */}
          <LobbyButton
            label="Start Game"
            accessibilityLabel={model.canStart ? "Start game" : "Start game, waiting for players"}
            onPress={model.start}
            disabled={!model.canStart}
            isPrimary
            preferFocus={model.canStart}
          />
          <LobbyButton
            label="Back"
            accessibilityLabel="Back to game selection"
            onPress={model.back}
            disabled={false}
            isPrimary={false}
            preferFocus={!model.canStart}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Player Row ────────────────────────────────────────────────────

const PlayerRow = React.memo(function PlayerRow({
  player,
}: {
  readonly player: LobbyPlayer;
}): React.JSX.Element {
  return (
    <View style={styles.playerRow}>
      <View style={[styles.avatarCircle, !player.connected && styles.avatarDisconnected]}>
        <Text style={styles.avatarText}>{playerInitial(player)}</Text>
      </View>
      <Text
        style={[styles.playerName, !player.connected && styles.playerNameDisconnected]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {player.name}
      </Text>
      {!player.connected && <Text style={styles.disconnectedBadge}>DISCONNECTED</Text>}
    </View>
  );
});

// ─── Lobby Button ──────────────────────────────────────────────────

function LobbyButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  isPrimary,
  preferFocus,
}: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly isPrimary: boolean;
  /** Request D-pad focus (and re-request it whenever this flips to true). */
  readonly preferFocus: boolean;
}): React.JSX.Element {
  return (
    <TVPressable
      style={[styles.button, isPrimary ? styles.buttonPrimary : styles.buttonSecondary]}
      focusedStyle={styles.buttonFocused}
      disabledStyle={styles.buttonDisabled}
      onPress={onPress}
      disabled={disabled}
      hasTVPreferredFocus={preferFocus}
      accessibilityLabel={accessibilityLabel}
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
    </TVPressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    flexDirection: "row",
    padding: 48,
  },
  errorText: {
    color: colors.danger,
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
  gameName: {
    color: colors.textBright,
    fontSize: 36,
    fontWeight: "700",
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
    paddingLeft: 32,
  },
  playerCountLabel: {
    color: colors.textMuted,
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
    color: colors.textFaint,
    fontSize: 24,
    fontStyle: "italic",
    marginTop: 24,
  },

  // Player row
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  avatarDisconnected: {
    backgroundColor: colors.disabled,
  },
  avatarText: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: "700",
  },
  playerName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "500",
    flex: 1,
  },
  playerNameDisconnected: {
    color: colors.textDim,
  },
  disconnectedBadge: {
    color: colors.danger,
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
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  buttonFocused: {
    borderColor: colors.textBright,
  },
  buttonLabel: {
    fontSize: 24,
    fontWeight: "700",
  },
  buttonLabelPrimary: {
    color: colors.textBright,
  },
  buttonLabelSecondary: {
    color: colors.textMuted,
  },
  buttonLabelDisabled: {
    color: colors.textFaint,
  },
});
