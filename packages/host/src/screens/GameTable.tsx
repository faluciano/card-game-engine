// ─── Game Table Screen ─────────────────────────────────────────────
// The main game display shown on the TV / host device. Renders the
// public view of the game state: zones with cards, player info, phase
// indicator, scores, and an end-of-game results overlay.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGameHost } from "@couch-kit/host";
import type {
  Card,
  CardGameState,
  Player,
  UIConfig,
  ZoneState,
} from "@card-engine/shared";
import type { HostAction, HostGameState } from "../types/host-state";
import { useGameOrchestrator } from "../hooks/useGameOrchestrator";
import { colors } from "../theme";

// ─── Constants ─────────────────────────────────────────────────────

const SUIT_SYMBOLS: Readonly<Record<string, string>> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const RED_SUITS = new Set(["hearts", "diamonds"]);

/** Maximum face-up cards rendered before showing a "+N more" indicator. */
const MAX_VISIBLE_CARDS = 12;

/** Threshold above which an all-face-down zone collapses to a stacked icon. */
const STACK_COLLAPSE_THRESHOLD = 6;

const TABLE_COLORS: Readonly<Record<string, string>> = {
  felt_green: colors.tableBg,
  wood: colors.tableBg,
  dark: colors.tableBg,
};

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
  const tableColor = resolveTableColor(engineState.ruleset.ui);
  const isFinished = engineState.status.kind === "finished";
  const isRoundEnd = engineState.currentPhase === "round_end";

  return (
    <View style={[styles.container, { backgroundColor: tableColor }]}>
      <StatusBar engineState={engineState} />

      <View style={styles.tableLayout}>
        <SharedZones engineState={engineState} />
        <PlayerZones engineState={engineState} />
        <ScoreBoard engineState={engineState} />
      </View>

      {(isFinished || isRoundEnd) && (
        <ResultsOverlay engineState={engineState} dispatch={dispatch} />
      )}
    </View>
  );
}

// ─── Status Bar ────────────────────────────────────────────────────

const StatusBar = React.memo(function StatusBar({
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
});

// ─── Shared Zones ──────────────────────────────────────────────────

const SharedZones = React.memo(function SharedZones({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const sharedZones = useMemo(
    () => getSharedZones(engineState),
    [engineState],
  );

  const activeSuit = engineState.stringVariables?.["active_suit"] ?? "";

  if (sharedZones.length === 0 && !activeSuit) return <></>;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TABLE</Text>
      <View style={styles.zonesRow}>
        {sharedZones.map(([name, zone]: [string, ZoneState]) => (
          <ZoneDisplay
            key={name}
            name={name}
            zone={zone}
            revealed={isPublicOnTable(engineState, name)}
          />
        ))}
        {activeSuit !== "" && <ActiveSuitIndicator suit={activeSuit} />}
      </View>
    </View>
  );
});

// ─── Player Zones ──────────────────────────────────────────────────

const PlayerZones = React.memo(function PlayerZones({
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
      {playerZoneGroups.map(({ player, index, zones, isCurrentTurn }: PlayerZoneGroup) => {
        const score = engineState.scores[`player_score:${index}`];
        const initial = player.name.trim().charAt(0).toUpperCase() || "?";
        return (
          <View
            key={player.id}
            style={[
              styles.playerSection,
              isCurrentTurn && styles.playerSectionActive,
            ]}
          >
            <View style={styles.playerHeader}>
              <View
                style={[
                  styles.avatar,
                  isCurrentTurn && styles.avatarActive,
                ]}
              >
                <Text
                  style={[
                    styles.avatarText,
                    isCurrentTurn && styles.avatarTextActive,
                  ]}
                >
                  {initial}
                </Text>
              </View>
              <Text
                style={[
                  styles.playerLabel,
                  isCurrentTurn && styles.playerLabelActive,
                ]}
              >
                {player.name}
              </Text>
              {typeof score === "number" && (
                <View style={styles.scoreChip}>
                  <Text style={styles.scoreChipText}>{score}</Text>
                </View>
              )}
              {isCurrentTurn && (
                <View style={styles.turnBadge}>
                  <Text style={styles.turnBadgeText}>TURN</Text>
                </View>
              )}
            </View>
            <View style={styles.zonesRow}>
              {zones.map(([name, zone]: [string, ZoneState]) => (
                <ZoneDisplay
                  key={name}
                  name={name}
                  zone={zone}
                  revealed={isPublicOnTable(engineState, name)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
});

// ─── Zone Display ──────────────────────────────────────────────────

const ZoneDisplay = React.memo(function ZoneDisplay({
  name,
  zone,
  revealed = false,
}: {
  readonly name: string;
  readonly zone: ZoneState;
  /**
   * When true, every card in the zone is shown face-up and fully fanned
   * (no stack/top-only collapse). Used for zones the whole table can see
   * (public visibility) on the shared TV god-view — e.g. player hands.
   */
  readonly revealed?: boolean;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const cards = useMemo(
    () =>
      revealed
        ? zone.cards.map((card) => (card.faceUp ? card : { ...card, faceUp: true }))
        : zone.cards,
    [revealed, zone.cards],
  );
  const isDiscard = name === "discard";

  // Track previous card count to detect newly dealt cards
  const prevCardCountRef = useRef(cards.length);
  const newCardStartIndex = useRef(-1);

  // Detect new cards on each render
  if (cards.length > prevCardCountRef.current) {
    // Cards were added — mark the start index of new cards
    newCardStartIndex.current = prevCardCountRef.current;
  } else if (cards.length !== prevCardCountRef.current) {
    // Cards were removed or count changed — reset
    newCardStartIndex.current = -1;
  }
  prevCardCountRef.current = cards.length;

  // Clear the "new" marker after animation completes (~500ms should cover stagger)
  useEffect(() => {
    if (newCardStartIndex.current >= 0) {
      const timer = setTimeout(() => {
        newCardStartIndex.current = -1;
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [cards.length]);

  const allFaceDown =
    !revealed && cards.length > 0 && cards.every((card) => !card.faceUp);
  const shouldCollapse =
    allFaceDown && cards.length > STACK_COLLAPSE_THRESHOLD;
  const hasFaceUpCards = cards.some((c) => c.faceUp);
  const shouldShowTopOnly =
    !revealed &&
    !allFaceDown &&
    hasFaceUpCards &&
    cards.length > STACK_COLLAPSE_THRESHOLD &&
    !expanded;

  return (
    <Pressable
      style={styles.zone}
      onPress={() => setExpanded((prev) => !prev)}
    >
      <Text style={styles.zoneName}>{formatZoneName(name)}</Text>
      <View style={styles.cardRow}>
        {cards.length === 0 ? (
          <View style={styles.emptyZone}>
            <Text style={styles.emptyZoneText}>Empty</Text>
          </View>
        ) : isDiscard ? (
          <DiscardPile topCard={cards[0]!} count={cards.length} />
        ) : shouldCollapse ? (
          <StackedDeck />
        ) : shouldShowTopOnly ? (
          <>
            <FlippableCardView card={cards[0]!} />
            <View style={styles.topCardMoreIndicator}>
              <Text style={styles.topCardMoreText}>
                +{cards.length - 1} more
              </Text>
            </View>
          </>
        ) : (
          <CappedCardList
            cards={cards}
            newCardStartIndex={newCardStartIndex.current}
          />
        )}
      </View>
    </Pressable>
  );
});

// ─── Stacked Deck (collapsed face-down pile) ──────────────────────

const StackedDeck = React.memo(function StackedDeck(): React.JSX.Element {
  return (
    <View style={styles.stackedDeck}>
      {/* Bottom shadow card */}
      <View style={[styles.card, styles.cardBack, styles.stackShadow2]} />
      {/* Middle shadow card */}
      <View style={[styles.card, styles.cardBack, styles.stackShadow1]} />
      {/* Top card */}
      <View style={[styles.card, styles.cardBack, styles.stackTop]}>
        <View style={styles.cardBackFrame} />
      </View>
    </View>
  );
});

// ─── Discard Pile (collapsed face-up pile with count badge) ───────

const DiscardPile = React.memo(function DiscardPile({
  topCard,
  count,
}: {
  readonly topCard: Card;
  readonly count: number;
}): React.JSX.Element {
  return (
    <View style={styles.stackedDeck}>
      {/* Bottom shadow card */}
      {count >= 3 && (
        <View style={[styles.card, styles.cardFace, styles.stackShadow2, { opacity: 0.4 }]} />
      )}
      {/* Middle shadow card */}
      {count >= 2 && (
        <View style={[styles.card, styles.cardFace, styles.stackShadow1, { opacity: 0.7 }]} />
      )}
      {/* Top card — face-up */}
      <View style={styles.stackTop}>
        <FlippableCardView card={topCard} />
      </View>
      {/* Count badge */}
      <View style={styles.stackBadge}>
        <Text style={styles.stackBadgeText}>{count}</Text>
      </View>
    </View>
  );
});

// ─── Active Suit Indicator ─────────────────────────────────────────

const ActiveSuitIndicator = React.memo(function ActiveSuitIndicator({
  suit,
}: {
  readonly suit: string;
}): React.JSX.Element {
  const symbol = SUIT_SYMBOLS[suit] ?? suit;
  const isRed = RED_SUITS.has(suit);
  const suitColor = isRed ? colors.suitRedBright : colors.text;

  return (
    <View style={styles.activeSuitContainer}>
      <Text style={styles.activeSuitLabel}>ACTIVE SUIT</Text>
      <Text style={[styles.activeSuitSymbol, { color: suitColor }]}>
        {symbol}
      </Text>
      <Text style={[styles.activeSuitName, { color: suitColor }]}>
        {suit.charAt(0).toUpperCase() + suit.slice(1)}
      </Text>
    </View>
  );
});

// ─── Capped Card List (with "+N more" overflow) ───────────────────

function CappedCardList({
  cards,
  newCardStartIndex = -1,
}: {
  readonly cards: readonly Card[];
  readonly newCardStartIndex?: number;
}): React.JSX.Element {
  const hiddenCount = cards.length - MAX_VISIBLE_CARDS;
  const visibleCards =
    hiddenCount > 0 ? cards.slice(-MAX_VISIBLE_CARDS) : cards;
  // Adjust the start index for visible slice
  const visibleOffset = hiddenCount > 0 ? hiddenCount : 0;

  return (
    <>
      {hiddenCount > 0 && (
        <View style={styles.moreIndicator}>
          <Text style={styles.moreIndicatorText}>+{hiddenCount} more</Text>
        </View>
      )}
      {visibleCards.map((card, i) => {
        const globalIndex = visibleOffset + i;
        const isNewCard =
          newCardStartIndex >= 0 && globalIndex >= newCardStartIndex;

        if (isNewCard) {
          const staggerDelay = (globalIndex - newCardStartIndex) * 80;
          return (
            <AnimatedCardView
              key={card.id}
              card={card}
              delay={staggerDelay}
            />
          );
        }

        return <FlippableCardView key={card.id} card={card} />;
      })}
    </>
  );
}

// ─── Card View ─────────────────────────────────────────────────────

const CardView = React.memo(function CardView({
  card,
}: {
  readonly card: Card;
}): React.JSX.Element {
  if (!card.faceUp) {
    return (
      <View style={[styles.card, styles.cardBack]}>
        <View style={styles.cardBackFrame} />
      </View>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;
  const isRed = RED_SUITS.has(card.suit);

  return (
    <View style={[styles.card, styles.cardFace]}>
      <View style={styles.cardCorner}>
        <Text style={[styles.cardRank, isRed && styles.cardRed]}>
          {card.rank}
        </Text>
        <Text style={[styles.cardSuit, isRed && styles.cardRed]}>
          {suitSymbol}
        </Text>
      </View>
      <Text style={[styles.cardPip, isRed && styles.cardRed]}>
        {suitSymbol}
      </Text>
    </View>
  );
});

// ─── Animated Card View ────────────────────────────────────────────

/**
 * Wraps a CardView with a slide-in + fade-in animation on mount.
 * Used for freshly dealt cards to create a dealing effect.
 */
const AnimatedCardView = React.memo(function AnimatedCardView({
  card,
  delay,
}: {
  readonly card: Card;
  readonly delay: number;
}): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 250,
        delay,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <CardView card={card} />
    </Animated.View>
  );
});

// ─── Flippable Card View ───────────────────────────────────────────

/**
 * Wraps CardView with a 3D flip animation when faceUp changes
 * from false to true. Uses rotateY to simulate turning a card over.
 */
const FlippableCardView = React.memo(function FlippableCardView({
  card,
}: {
  readonly card: Card;
}): React.JSX.Element {
  const flipAnim = useRef(new Animated.Value(card.faceUp ? 1 : 0)).current;
  const wasFaceUpRef = useRef(card.faceUp);

  useEffect(() => {
    if (card.faceUp && !wasFaceUpRef.current) {
      // Card just flipped face-up — animate
      flipAnim.setValue(0);
      Animated.timing(flipAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
    wasFaceUpRef.current = card.faceUp;
  }, [card.faceUp, flipAnim]);

  const rotateY = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "90deg", "0deg"],
  });

  const cardOpacity = flipAnim.interpolate({
    inputRange: [0, 0.49, 0.5, 1],
    outputRange: [1, 1, 1, 1],
  });

  // Show back for first half, face for second half
  // We can't conditionally render based on animated value,
  // so we use a simpler approach: just animate the rotation
  // and let CardView render the current state
  return (
    <Animated.View
      style={{
        opacity: cardOpacity,
        transform: [{ perspective: 800 }, { rotateY }],
      }}
    >
      <CardView card={card} />
    </Animated.View>
  );
});

// ─── Score Board ───────────────────────────────────────────────────

const ScoreBoard = React.memo(function ScoreBoard({
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
});

// ─── Results Overlay ───────────────────────────────────────────────

const ResultsOverlay = React.memo(function ResultsOverlay({
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
              result > 0 ? colors.success : result < 0 ? colors.redAlt : colors.amber;

            return (
              <View
                key={player.id}
                style={resultsStyles.playerRow}
              >
                <Text style={resultsStyles.playerName} numberOfLines={1} ellipsizeMode="tail">
                  {player.name}
                </Text>
                <Text style={resultsStyles.handValue}>
                  {handValue}
                </Text>
                <View
                  style={[
                    resultsStyles.resultBadge,
                    { backgroundColor: resultColor },
                  ]}
                >
                  <Text
                    style={resultsStyles.resultBadgeText}
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
                  style={resultsStyles.divider}
                />
                {npcScores.map(({ label, score }) => (
                  <View
                    key={label}
                    style={resultsStyles.npcRow}
                  >
                    <Text style={resultsStyles.npcLabel}>
                      {label}
                    </Text>
                    <Text style={resultsStyles.npcScore}>
                      {score}
                    </Text>
                  </View>
                ))}
              </>
            );
          })()}

          {/* Info text — phones trigger new round, not TV */}
          <Text
            style={resultsStyles.waitingText}
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
});

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

/**
 * Determines whether a zone should render face-up on the shared TV god-view.
 * A zone is "public on the table" when its effective visibility (honoring
 * phase overrides) is `public` — the whole table is meant to see it, so we
 * reveal it here even if individual cards were dealt face-down.
 */
function isPublicOnTable(
  engineState: CardGameState,
  zoneName: string,
): boolean {
  const baseName = zoneName.replace(/:\d+$/, "");
  const def = engineState.ruleset.zones.find((z) => z.name === baseName);
  if (!def) return false;
  const override = def.phaseOverrides?.find(
    (o) => o.phase === engineState.currentPhase,
  );
  const visibility = override?.visibility ?? def.visibility;
  return visibility.kind === "public";
}

interface PlayerZoneGroup {
  readonly player: Player;
  readonly index: number;
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
        index: i,
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

/** Resolves the table background color from UI config. */
function resolveTableColor(ui: UIConfig | undefined): string {
  if (!ui) return TABLE_COLORS.felt_green!;
  if (ui.tableColor === "custom" && ui.customColor) return ui.customColor;
  return TABLE_COLORS[ui.tableColor] ?? TABLE_COLORS.felt_green!;
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.feltDark,
  },
  errorText: {
    color: colors.danger,
    fontSize: 28,
    textAlign: "center",
    marginTop: 48,
  },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.tableBgEdge,
    borderBottomWidth: 1,
    borderBottomColor: colors.tableBorder,
    paddingHorizontal: 32,
    paddingVertical: 10,
    gap: 32,
  },
  phaseLabel: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: "700",
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 22,
  },
  turnIndicator: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: "600",
  },
  turnNumber: {
    color: colors.textMuted,
    fontSize: 20,
    marginLeft: "auto",
  },

  // Table layout
  tableLayout: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    paddingBottom: 20,
  },

  // Sections
  section: {
    flex: 1,
    width: "100%",
    maxWidth: 1280,
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 6,
  },

  // Zone layout
  zonesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 20,
  },
  zone: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 10,
    minWidth: 140,
  },
  zoneName: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyZone: {
    width: 52,
    height: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyZoneText: {
    color: colors.textFaint,
    fontSize: 12,
  },

  // Cards
  card: {
    width: 52,
    height: 74,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
  cardFace: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardFaceBorder,
  },
  cardBack: {
    backgroundColor: colors.dark,
    borderWidth: 1,
    borderColor: colors.goldDim,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 5,
  },
  cardBackFrame: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.goldDim,
    borderRadius: 4,
  },
  cardCorner: {
    position: "absolute",
    top: 4,
    left: 5,
    alignItems: "center",
  },
  cardRank: {
    color: colors.cardInk,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 18,
  },
  cardSuit: {
    color: colors.cardInk,
    fontSize: 13,
    lineHeight: 14,
  },
  cardPip: {
    color: colors.cardInk,
    fontSize: 22,
    opacity: 0.85,
  },
  cardRed: {
    color: colors.suitRed,
  },

  // Stacked deck (collapsed face-down pile)
  stackedDeck: {
    width: 78,
    height: 92,
    position: "relative",
  },
  stackShadow2: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0.4,
  },
  stackShadow1: {
    position: "absolute",
    top: 5,
    left: 5,
    opacity: 0.7,
  },
  stackTop: {
    position: "absolute",
    top: 10,
    left: 10,
  },
  stackBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: colors.gold,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  stackBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "800",
  },

  // Overflow indicator
  moreIndicator: {
    height: 72,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  moreIndicatorText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },

  // Top card only indicator (collapsed face-up zone)
  topCardMoreIndicator: {
    height: 72,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  topCardMoreText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },

  // Active suit indicator
  activeSuitContainer: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.gold,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  activeSuitLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeSuitSymbol: {
    fontSize: 36,
    lineHeight: 42,
  },
  activeSuitName: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
  },

  // Player sections
  playerSection: {
    width: "100%",
    marginBottom: 8,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  playerSectionActive: {
    backgroundColor: colors.tableSurface,
    borderColor: colors.goldDim,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 6,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  avatarText: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: "800",
  },
  avatarTextActive: {
    color: colors.black,
  },
  playerLabel: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
  },
  playerLabelActive: {
    color: colors.textBright,
  },
  scoreChip: {
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    minWidth: 34,
    alignItems: "center",
  },
  scoreChipText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: "800",
  },
  turnBadge: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  turnBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },

  // Score board
  scoreBoard: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 12,
    minWidth: 420,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.tableBorder,
  },
  scoreName: {
    color: colors.text,
    fontSize: 22,
  },
  scoreValue: {
    color: colors.gold,
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
    backgroundColor: colors.tableSurface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 48,
    alignItems: "center",
    minWidth: 400,
  },
  overlayTitle: {
    color: colors.gold,
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 16,
  },
  overlayWinner: {
    color: colors.textBright,
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 36,
  },
  overlayButtons: {
    flexDirection: "row",
    gap: 20,
  },
  overlayButton: {
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderWidth: 3,
    borderColor: "transparent",
  },
  overlayButtonPrimary: {
    backgroundColor: colors.gold,
  },
  overlayButtonSecondary: {
    backgroundColor: colors.tableSurfaceRaised,
  },
  overlayButtonFocused: {
    borderColor: colors.gold,
  },
  overlayButtonText: {
    color: colors.black,
    fontSize: 24,
    fontWeight: "700",
  },
  overlayButtonTextSecondary: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
  },
});

const resultsStyles = StyleSheet.create({
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 12,
  },
  playerName: {
    color: colors.text,
    fontSize: 28,
    flex: 1,
  },
  handValue: {
    color: colors.textMuted,
    fontSize: 24,
  },
  resultBadge: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  resultBadgeText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "700",
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
    paddingTop: 12,
  },
  npcRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 4,
  },
  npcLabel: {
    color: colors.neutral,
    fontSize: 24,
    flex: 1,
  },
  npcScore: {
    color: colors.textMuted,
    fontSize: 24,
  },
  waitingText: {
    color: colors.textDim,
    fontSize: 18,
    marginTop: 24,
    textAlign: "center",
  },
});
