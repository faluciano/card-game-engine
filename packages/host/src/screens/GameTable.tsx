// ─── Game Table Screen ─────────────────────────────────────────────
// The main game display shown on the TV / host device. A thin React
// Native renderer over `useGameTableModel` from host-core: zones with
// cards, player info, phase indicator, scores, and the end-of-round /
// game-over overlay. The deal-in and flip animations use RN `Animated`
// with timing constants shared with the web display.

import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { Card, HostAction, HostGameState } from "@card-engine/shared";
import {
  DEAL_DURATION_MS,
  DEAL_SLIDE_OFFSET,
  FLIP_DURATION_MS,
  cardInkColor,
  colors,
  formatZoneName,
  getCappedCardList,
  suitSymbol,
  useFlipOnReveal,
  useGameTableModel,
  useZoneModel,
  type ActiveSuitModel,
  type PlayerSectionModel,
  type ResultsOverlayModel,
  type ScoreRow,
  type StatusBarModel,
  type ZoneViewModel,
} from "@card-engine/host-core";

// ─── Component ─────────────────────────────────────────────────────

export function GameTable(): React.JSX.Element {
  const { state, dispatch } = useGameHost<HostGameState, HostAction>();
  const model = useGameTableModel(state, dispatch);

  // Guard: must be on game_table with active engine state
  if (model.kind !== "table") {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{model.message}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: model.tableColor }]}>
      <StatusBar model={model.statusBar} />

      <View style={styles.tableLayout}>
        {model.showSharedSection && (
          <SharedZones zones={model.sharedZones} activeSuit={model.activeSuit} />
        )}
        <PlayerZones sections={model.playerSections} />
        <ScoreBoard rows={model.scoreRows} />
      </View>

      {model.overlay && <ResultsOverlay overlay={model.overlay} onBackToMenu={model.backToMenu} />}
    </View>
  );
}

// ─── Status Bar ────────────────────────────────────────────────────

const StatusBar = React.memo(function StatusBar({
  model,
}: {
  readonly model: StatusBarModel;
}): React.JSX.Element {
  return (
    <View style={styles.statusBar}>
      <Text style={styles.phaseLabel}>Phase: {model.phaseLabel}</Text>
      <Text style={styles.statusLabel}>{model.statusLabel}</Text>
      {model.currentPlayerName !== null && (
        <Text style={styles.turnIndicator}>Turn: {model.currentPlayerName}</Text>
      )}
      <Text style={styles.turnNumber}>Round {model.turnNumber}</Text>
    </View>
  );
});

// ─── Shared Zones ──────────────────────────────────────────────────

const SharedZones = React.memo(function SharedZones({
  zones,
  activeSuit,
}: {
  readonly zones: readonly ZoneViewModel[];
  readonly activeSuit: ActiveSuitModel | null;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TABLE</Text>
      <View style={styles.zonesRow}>
        {zones.map((view) => (
          <ZoneDisplay key={view.name} view={view} />
        ))}
        {activeSuit && <ActiveSuitIndicator model={activeSuit} />}
      </View>
    </View>
  );
});

// ─── Player Zones ──────────────────────────────────────────────────

const PlayerZones = React.memo(function PlayerZones({
  sections,
}: {
  readonly sections: readonly PlayerSectionModel[];
}): React.JSX.Element | null {
  if (sections.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>PLAYERS</Text>
      {sections.map(({ player, zoneViews, isCurrentTurn, score, initial }) => (
        <View
          key={player.id}
          style={[styles.playerSection, isCurrentTurn && styles.playerSectionActive]}
        >
          <View style={styles.playerHeader}>
            <View style={[styles.avatar, isCurrentTurn && styles.avatarActive]}>
              <Text style={[styles.avatarText, isCurrentTurn && styles.avatarTextActive]}>
                {initial}
              </Text>
            </View>
            <Text style={[styles.playerLabel, isCurrentTurn && styles.playerLabelActive]}>
              {player.name}
            </Text>
            {score !== null && (
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
            {zoneViews.map((view) => (
              <ZoneDisplay key={view.name} view={view} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
});

// ─── Zone Display ──────────────────────────────────────────────────

const ZoneDisplay = React.memo(function ZoneDisplay({
  view,
}: {
  readonly view: ZoneViewModel;
}): React.JSX.Element {
  const { cards, mode, newCardStartIndex, toggleExpanded } = useZoneModel(
    view.name,
    view.zone,
    view.revealed,
  );

  return (
    <Pressable style={styles.zone} onPress={toggleExpanded}>
      <Text style={styles.zoneName}>{formatZoneName(view.name)}</Text>
      <View style={styles.cardRow}>
        {mode === "empty" ? (
          <View style={styles.emptyZone}>
            <Text style={styles.emptyZoneText}>Empty</Text>
          </View>
        ) : mode === "discard" ? (
          <DiscardPile topCard={cards[0]!} count={cards.length} />
        ) : mode === "stack" ? (
          <StackedDeck />
        ) : mode === "top_only" ? (
          <>
            <FlippableCardView card={cards[0]!} />
            <View style={styles.topCardMoreIndicator}>
              <Text style={styles.topCardMoreText}>+{cards.length - 1} more</Text>
            </View>
          </>
        ) : (
          <CappedCardList cards={cards} newCardStartIndex={newCardStartIndex} />
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
  model,
}: {
  readonly model: ActiveSuitModel;
}): React.JSX.Element {
  return (
    <View style={styles.activeSuitContainer}>
      <Text style={styles.activeSuitLabel}>ACTIVE SUIT</Text>
      <Text style={[styles.activeSuitSymbol, { color: model.color }]}>{model.symbol}</Text>
      <Text style={[styles.activeSuitName, { color: model.color }]}>{model.name}</Text>
    </View>
  );
});

// ─── Capped Card List (with "+N more" overflow) ───────────────────

function CappedCardList({
  cards,
  newCardStartIndex,
}: {
  readonly cards: readonly Card[];
  readonly newCardStartIndex: number;
}): React.JSX.Element {
  const { hiddenCount, cards: visible } = getCappedCardList(cards, newCardStartIndex);

  return (
    <>
      {hiddenCount > 0 && (
        <View style={styles.moreIndicator}>
          <Text style={styles.moreIndicatorText}>+{hiddenCount} more</Text>
        </View>
      )}
      {visible.map(({ card, isNew, dealDelay }) =>
        isNew ? (
          <AnimatedCardView key={card.id} card={card} delay={dealDelay} />
        ) : (
          <FlippableCardView key={card.id} card={card} />
        ),
      )}
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

  const symbol = suitSymbol(card.suit);
  const ink = { color: cardInkColor(card) };

  return (
    <View style={[styles.card, styles.cardFace]}>
      <View style={styles.cardCorner}>
        <Text style={[styles.cardRank, ink]}>{card.rank}</Text>
        <Text style={[styles.cardSuit, ink]}>{symbol}</Text>
      </View>
      <Text style={[styles.cardPip, ink]}>{symbol}</Text>
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
  const translateY = useRef(new Animated.Value(DEAL_SLIDE_OFFSET)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: DEAL_DURATION_MS,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: DEAL_DURATION_MS,
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

  useFlipOnReveal(card.faceUp, () => {
    // Card just flipped face-up — animate
    flipAnim.setValue(0);
    Animated.timing(flipAnim, {
      toValue: 1,
      duration: FLIP_DURATION_MS,
      useNativeDriver: true,
    }).start();
  });

  const rotateY = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "90deg", "0deg"],
  });

  // We can't conditionally render based on animated value, so we just
  // animate the rotation and let CardView render the current state.
  return (
    <Animated.View style={{ transform: [{ perspective: 800 }, { rotateY }] }}>
      <CardView card={card} />
    </Animated.View>
  );
});

// ─── Score Board ───────────────────────────────────────────────────

const ScoreBoard = React.memo(function ScoreBoard({
  rows,
}: {
  readonly rows: readonly ScoreRow[];
}): React.JSX.Element | null {
  if (rows.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>SCORES</Text>
      <View style={styles.scoreBoard}>
        {rows.map(({ key, label, score }) => (
          <View key={key} style={styles.scoreRow}>
            <Text style={styles.scoreName}>{label}</Text>
            <Text style={styles.scoreValue}>{score}</Text>
          </View>
        ))}
      </View>
    </View>
  );
});

// ─── Results Overlay ───────────────────────────────────────────────

const ResultsOverlay = React.memo(function ResultsOverlay({
  overlay,
  onBackToMenu,
}: {
  readonly overlay: ResultsOverlayModel;
  readonly onBackToMenu: () => void;
}): React.JSX.Element {
  const [focusedButton, setFocusedButton] = useState<string | null>(null);

  const backButton = (
    <View style={styles.overlayButtons}>
      <Pressable
        style={[
          styles.overlayButton,
          styles.overlayButtonSecondary,
          focusedButton === "back" && styles.overlayButtonFocused,
        ]}
        onFocus={() => setFocusedButton("back")}
        onBlur={() => setFocusedButton(null)}
        onPress={onBackToMenu}
        hasTVPreferredFocus
      >
        <Text style={styles.overlayButtonTextSecondary}>Back to Menu</Text>
      </Pressable>
    </View>
  );

  if (overlay.kind === "round_end") {
    // ── Round-end view: show per-player results ──
    return (
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <Text style={styles.overlayTitle}>ROUND COMPLETE</Text>

          {/* Per-player results */}
          {overlay.players.map((row) => (
            <View key={row.playerId} style={resultsStyles.playerRow}>
              <Text style={resultsStyles.playerName} numberOfLines={1} ellipsizeMode="tail">
                {row.name}
              </Text>
              <Text style={resultsStyles.handValue}>{row.handValue}</Text>
              <View style={[resultsStyles.resultBadge, { backgroundColor: row.resultColor }]}>
                <Text style={resultsStyles.resultBadgeText}>{row.resultLabel}</Text>
              </View>
            </View>
          ))}

          {/* NPC / opponent scores */}
          {overlay.npcScores.length > 0 && (
            <>
              <View style={resultsStyles.divider} />
              {overlay.npcScores.map(({ label, score }) => (
                <View key={label} style={resultsStyles.npcRow}>
                  <Text style={resultsStyles.npcLabel}>{label}</Text>
                  <Text style={resultsStyles.npcScore}>{score}</Text>
                </View>
              ))}
            </>
          )}

          {/* Info text — phones trigger new round, not TV */}
          <Text style={resultsStyles.waitingText}>Waiting for players to start new round...</Text>

          {backButton}
        </View>
      </View>
    );
  }

  // ── Finished view ──
  return (
    <View style={styles.overlay}>
      <View style={styles.overlayCard}>
        <Text style={styles.overlayTitle}>GAME OVER</Text>
        <Text style={styles.overlayWinner}>
          {overlay.winnerName !== null ? `🏆 ${overlay.winnerName} wins!` : "It's a draw!"}
        </Text>

        {backButton}
      </View>
    </View>
  );
});

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
  overlayButtonSecondary: {
    backgroundColor: colors.tableSurfaceRaised,
  },
  overlayButtonFocused: {
    borderColor: colors.gold,
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
