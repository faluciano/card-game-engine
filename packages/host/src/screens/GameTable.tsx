// ─── Game Table Screen ─────────────────────────────────────────────
// The main game display shown on the TV / host device. A thin React
// Native renderer over `useGameTableModel` from host-core: zones with
// cards, player info, phase indicator, scores, and the end-of-round /
// game-over overlay. The deal-in and flip animations use RN `Animated`
// with timing constants shared with the web display.

import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { Card, HostAction, HostGameState } from "@card-engine/shared";
import {
  DEAL_DURATION_MS,
  DEAL_SLIDE_OFFSET,
  FLIP_DURATION_MS,
  cardInkColor,
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
import { resultsStyles, styles } from "./GameTable.styles";

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
