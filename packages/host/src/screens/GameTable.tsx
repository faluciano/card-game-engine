// ─── Game Table Screen ─────────────────────────────────────────────
// The main game display shown on the TV / host device. Renders the
// public view of the game state: zones with cards, player info, phase
// indicator, scores, and an end-of-game results overlay.

import React, { useMemo, useState, useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGameHost } from "@couch-kit/host";
import type {
  Card,
  CardGameState,
  Player,
  ZoneState,
} from "@card-engine/shared";
import type { HostAction, HostGameState } from "../types/host-state";
import { useGameOrchestrator } from "../hooks/useGameOrchestrator";

// ─── Constants ─────────────────────────────────────────────────────

const SUIT_SYMBOLS: Readonly<Record<string, string>> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const RED_SUITS = new Set(["hearts", "diamonds"]);

// ─── Component ─────────────────────────────────────────────────────

export function GameTable(): React.JSX.Element {
  const { state, dispatch } = useGameHost<HostGameState, HostAction>();
  useGameOrchestrator(state, dispatch);

  // Guard: must be on game_table with active engine state
  if (state.screen.tag !== "game_table") {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Invalid screen state</Text>
      </View>
    );
  }

  if (state.engineState === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No game in progress</Text>
      </View>
    );
  }

  const engineState = state.engineState;
  const isFinished = engineState.status.kind === "finished";
  const isRoundEnd = engineState.currentPhase === "round_end";

  return (
    <View style={styles.container}>
      <StatusBar engineState={engineState} />

      <ScrollView
        style={styles.tableScroll}
        contentContainerStyle={styles.tableContent}
      >
        <SharedZones engineState={engineState} />
        <PlayerZones engineState={engineState} />
        <ScoreBoard engineState={engineState} />
      </ScrollView>

      {(isFinished || isRoundEnd) && (
        <ResultsOverlay engineState={engineState} dispatch={dispatch} />
      )}
    </View>
  );
}

// ─── Status Bar ────────────────────────────────────────────────────

function StatusBar({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const currentPlayer =
    engineState.players[engineState.currentPlayerIndex] ?? null;
  const statusLabel = formatStatusKind(engineState.status.kind);

  return (
    <View style={styles.statusBar}>
      <Text style={styles.phaseLabel}>
        Phase: {formatPhaseName(engineState.currentPhase)}
      </Text>
      <Text style={styles.statusLabel}>{statusLabel}</Text>
      {currentPlayer && (
        <Text style={styles.turnIndicator}>
          Turn: {currentPlayer.name}
        </Text>
      )}
      <Text style={styles.turnNumber}>Round {engineState.turnNumber}</Text>
    </View>
  );
}

// ─── Shared Zones ──────────────────────────────────────────────────

function SharedZones({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const sharedZones = useMemo(
    () => getSharedZones(engineState),
    [engineState],
  );

  if (sharedZones.length === 0) return <></>;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TABLE</Text>
      <View style={styles.zonesRow}>
        {sharedZones.map(([name, zone]: [string, ZoneState]) => (
          <ZoneDisplay key={name} name={name} zone={zone} />
        ))}
      </View>
    </View>
  );
}

// ─── Player Zones ──────────────────────────────────────────────────

function PlayerZones({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const playerZoneGroups = useMemo(
    () => getPlayerZoneGroups(engineState),
    [engineState],
  );

  if (playerZoneGroups.length === 0) return <></>;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>PLAYERS</Text>
      {playerZoneGroups.map(({ player, zones, isCurrentTurn }: PlayerZoneGroup) => (
        <View key={player.id} style={styles.playerSection}>
          <View style={styles.playerHeader}>
            <View
              style={[
                styles.playerDot,
                isCurrentTurn && styles.playerDotActive,
              ]}
            />
            <Text
              style={[
                styles.playerLabel,
                isCurrentTurn && styles.playerLabelActive,
              ]}
            >
              {player.name}
              {isCurrentTurn ? "  ◀ TURN" : ""}
            </Text>
          </View>
          <View style={styles.zonesRow}>
            {zones.map(([name, zone]: [string, ZoneState]) => (
              <ZoneDisplay key={name} name={name} zone={zone} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Zone Display ──────────────────────────────────────────────────

function ZoneDisplay({
  name,
  zone,
}: {
  readonly name: string;
  readonly zone: ZoneState;
}): React.JSX.Element {
  return (
    <View style={styles.zone}>
      <Text style={styles.zoneName}>
        {formatZoneName(name)} ({zone.cards.length} cards)
      </Text>
      <View style={styles.cardRow}>
        {zone.cards.length === 0 ? (
          <View style={styles.emptyZone}>
            <Text style={styles.emptyZoneText}>Empty</Text>
          </View>
        ) : (
          zone.cards.map((card) => (
            <CardView key={card.id} card={card} />
          ))
        )}
      </View>
    </View>
  );
}

// ─── Card View ─────────────────────────────────────────────────────

function CardView({
  card,
}: {
  readonly card: Card;
}): React.JSX.Element {
  if (!card.faceUp) {
    return (
      <View style={[styles.card, styles.cardBack]}>
        <Text style={styles.cardBackText}>🂠</Text>
      </View>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;
  const isRed = RED_SUITS.has(card.suit);

  return (
    <View style={[styles.card, styles.cardFace]}>
      <Text style={[styles.cardRank, isRed && styles.cardRed]}>
        {card.rank}
      </Text>
      <Text style={[styles.cardSuit, isRed && styles.cardRed]}>
        {suitSymbol}
      </Text>
    </View>
  );
}

// ─── Score Board ───────────────────────────────────────────────────

function ScoreBoard({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const scoreEntries = Object.entries(engineState.scores);
  if (scoreEntries.length === 0) return <></>;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>SCORES</Text>
      <View style={styles.scoreBoard}>
        {scoreEntries.map(([key, score]) => {
          const displayName = resolveScoreLabel(key, engineState.players);
          return (
            <View key={key} style={styles.scoreRow}>
              <Text style={styles.scoreName}>{displayName}</Text>
              <Text style={styles.scoreValue}>{score}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Results Overlay ───────────────────────────────────────────────

function ResultsOverlay({
  engineState,
  dispatch,
}: {
  readonly engineState: CardGameState;
  readonly dispatch: (action: HostAction) => void;
}): React.JSX.Element {
  const [focusedButton, setFocusedButton] = useState<string | null>(null);
  const isRoundEnd = engineState.currentPhase === "round_end";
  const isFinished = engineState.status.kind === "finished";

  // Guard: only show for round_end or finished
  if (!isRoundEnd && !isFinished) return <></>;

  const handleBackToMenu = useCallback(() => {
    dispatch({ type: "BACK_TO_PICKER" });
  }, [dispatch]);

  if (isRoundEnd) {
    // ── Round-end view: show per-player results ──
    return (
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <Text style={styles.overlayTitle}>ROUND COMPLETE</Text>

          {/* Per-player results */}
          {engineState.players.map((player, index) => {
            const handValue = engineState.scores[`player_score:${index}`] ?? 0;
            const result = engineState.scores[`result:${index}`] ?? 0;
            const resultLabel =
              result > 0 ? "WIN" : result < 0 ? "LOSS" : "DRAW";
            const resultColor =
              result > 0 ? "#4caf50" : result < 0 ? "#f44336" : "#ffc107";

            return (
              <View
                key={player.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 16,
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: "#e0e0e0", fontSize: 28, flex: 1 }}>
                  {player.name}
                </Text>
                <Text style={{ color: "#b0b0b0", fontSize: 24 }}>
                  {handValue}
                </Text>
                <View
                  style={{
                    backgroundColor: resultColor,
                    borderRadius: 8,
                    paddingHorizontal: 16,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}
                  >
                    {resultLabel}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* NPC / opponent scores */}
          {(() => {
            const npcScores = Object.entries(engineState.scores)
              .filter(([key]) => key.endsWith("_score") && !key.startsWith("player_score:"))
              .map(([key, value]) => ({
                label: key.replace(/_score$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
                score: value,
              }));

            if (npcScores.length === 0) return null;

            return (
              <>
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "#333",
                    marginTop: 8,
                    paddingTop: 12,
                  }}
                />
                {npcScores.map(({ label, score }) => (
                  <View
                    key={label}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 16,
                      marginBottom: 4,
                    }}
                  >
                    <Text style={{ color: "#a0a0a0", fontSize: 24, flex: 1 }}>
                      {label}
                    </Text>
                    <Text style={{ color: "#b0b0b0", fontSize: 24 }}>
                      {score}
                    </Text>
                  </View>
                ))}
              </>
            );
          })()}

          {/* Info text — phones trigger new round, not TV */}
          <Text
            style={{
              color: "#888",
              fontSize: 18,
              marginTop: 24,
              textAlign: "center",
            }}
          >
            Waiting for players to start new round...
          </Text>

          <View style={styles.overlayButtons}>
            <Pressable
              style={[
                styles.overlayButton,
                styles.overlayButtonSecondary,
                focusedButton === "back" && styles.overlayButtonFocused,
              ]}
              onFocus={() => setFocusedButton("back")}
              onBlur={() => setFocusedButton(null)}
              onPress={handleBackToMenu}
              hasTVPreferredFocus
            >
              <Text style={styles.overlayButtonTextSecondary}>
                Back to Menu
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Finished view (existing behavior) ──
  const { winnerId } = engineState.status as {
    readonly winnerId: string | null;
  };
  const winner = winnerId
    ? engineState.players.find((p) => p.id === winnerId)
    : null;

  return (
    <View style={styles.overlay}>
      <View style={styles.overlayCard}>
        <Text style={styles.overlayTitle}>GAME OVER</Text>
        {winner ? (
          <Text style={styles.overlayWinner}>
            🏆 {winner.name} wins!
          </Text>
        ) : (
          <Text style={styles.overlayWinner}>It's a draw!</Text>
        )}

        <View style={styles.overlayButtons}>
          <Pressable
            style={[
              styles.overlayButton,
              styles.overlayButtonSecondary,
              focusedButton === "back" && styles.overlayButtonFocused,
            ]}
            onFocus={() => setFocusedButton("back")}
            onBlur={() => setFocusedButton(null)}
            onPress={handleBackToMenu}
            hasTVPreferredFocus
          >
            <Text style={styles.overlayButtonTextSecondary}>
              Back to Menu
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Pure Helpers ──────────────────────────────────────────────────

/** Returns shared (non-player-owned) zone entries. */
function getSharedZones(
  engineState: CardGameState,
): readonly [string, ZoneState][] {
  return Object.entries(engineState.zones).filter(
    ([name]) => !isPlayerZone(name),
  );
}

/** Checks if a zone name follows the per-player pattern (e.g., "hand:0"). */
function isPlayerZone(name: string): boolean {
  return /:\d+$/.test(name);
}

interface PlayerZoneGroup {
  readonly player: Player;
  readonly zones: readonly [string, ZoneState][];
  readonly isCurrentTurn: boolean;
}

/** Groups per-player zones under their owning player. */
function getPlayerZoneGroups(
  engineState: CardGameState,
): readonly PlayerZoneGroup[] {
  const groups: PlayerZoneGroup[] = [];

  for (let i = 0; i < engineState.players.length; i++) {
    const player = engineState.players[i]!;
    const playerSuffix = `:${i}`;
    const zones = Object.entries(engineState.zones).filter(([name]) =>
      name.endsWith(playerSuffix),
    );

    if (zones.length > 0) {
      groups.push({
        player,
        zones,
        isCurrentTurn: i === engineState.currentPlayerIndex,
      });
    }
  }

  return groups;
}

/** Formats a phase name for display: "player_turns" → "Player Turns" */
function formatPhaseName(phase: string): string {
  return phase
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Formats a zone name for display: "draw_pile" → "Draw Pile", "hand:0" → "Hand" */
function formatZoneName(name: string): string {
  const baseName = name.replace(/:\d+$/, "");
  return formatPhaseName(baseName);
}

/** Resolves a score key like "player:0" or "result:1" to a human-readable label. */
function resolveScoreLabel(key: string, players: readonly Player[]): string {
  const playerMatch = key.match(/^player_score:(\d+)$/);
  if (playerMatch) {
    const player = players[Number(playerMatch[1])];
    return player?.name ?? key;
  }
  const resultMatch = key.match(/^result:(\d+)$/);
  if (resultMatch) {
    const player = players[Number(resultMatch[1])];
    return player ? `${player.name} (Result)` : key;
  }
  // Non-indexed keys like "dealer_score" — humanize
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Formats a status kind for display. */
function formatStatusKind(kind: string): string {
  switch (kind) {
    case "waiting_for_players":
      return "Waiting for Players";
    case "in_progress":
      return "In Progress";
    case "paused":
      return "Paused";
    case "finished":
      return "Finished";
    default:
      return kind;
  }
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d3320",
  },
  errorText: {
    color: "#ff5252",
    fontSize: 28,
    textAlign: "center",
    marginTop: 48,
  },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0a2818",
    paddingHorizontal: 32,
    paddingVertical: 16,
    gap: 32,
  },
  phaseLabel: {
    color: "#66bb6a",
    fontSize: 22,
    fontWeight: "700",
  },
  statusLabel: {
    color: "#a5d6a7",
    fontSize: 22,
  },
  turnIndicator: {
    color: "#ffd54f",
    fontSize: 22,
    fontWeight: "600",
  },
  turnNumber: {
    color: "#81c784",
    fontSize: 20,
    marginLeft: "auto",
  },

  // Table layout
  tableScroll: {
    flex: 1,
  },
  tableContent: {
    padding: 32,
    paddingBottom: 48,
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: "#a5d6a7",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12,
  },

  // Zone layout
  zonesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
  },
  zone: {
    backgroundColor: "#1a4d2e",
    borderRadius: 12,
    padding: 16,
    minWidth: 160,
  },
  zoneName: {
    color: "#c8e6c9",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyZone: {
    width: 52,
    height: 72,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#2e7d46",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyZoneText: {
    color: "#4caf50",
    fontSize: 12,
  },

  // Cards
  card: {
    width: 52,
    height: 72,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cardFace: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cccccc",
  },
  cardBack: {
    backgroundColor: "#1565c0",
    borderWidth: 1,
    borderColor: "#0d47a1",
  },
  cardBackText: {
    fontSize: 28,
  },
  cardRank: {
    color: "#1a1a1a",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  cardSuit: {
    color: "#1a1a1a",
    fontSize: 20,
    lineHeight: 24,
  },
  cardRed: {
    color: "#d32f2f",
  },

  // Player sections
  playerSection: {
    marginBottom: 16,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  playerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#555555",
    marginRight: 10,
  },
  playerDotActive: {
    backgroundColor: "#ffd54f",
  },
  playerLabel: {
    color: "#e0e0e0",
    fontSize: 22,
    fontWeight: "600",
  },
  playerLabelActive: {
    color: "#ffd54f",
  },

  // Score board
  scoreBoard: {
    backgroundColor: "#1a4d2e",
    borderRadius: 12,
    padding: 16,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#2e7d46",
  },
  scoreName: {
    color: "#e0e0e0",
    fontSize: 22,
  },
  scoreValue: {
    color: "#ffd54f",
    fontSize: 22,
    fontWeight: "700",
  },

  // Results overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayCard: {
    backgroundColor: "#1e1e1e",
    borderRadius: 24,
    padding: 48,
    alignItems: "center",
    minWidth: 400,
  },
  overlayTitle: {
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 16,
  },
  overlayWinner: {
    color: "#ffd54f",
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 36,
  },
  overlayButtons: {
    flexDirection: "row",
    gap: 20,
  },
  overlayButton: {
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 36,
    borderWidth: 3,
    borderColor: "transparent",
  },
  overlayButtonPrimary: {
    backgroundColor: "#7c4dff",
  },
  overlayButtonSecondary: {
    backgroundColor: "#333333",
  },
  overlayButtonFocused: {
    borderColor: "#ffffff",
  },
  overlayButtonText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
  },
  overlayButtonTextSecondary: {
    color: "#b0b0b0",
    fontSize: 24,
    fontWeight: "700",
  },
});
