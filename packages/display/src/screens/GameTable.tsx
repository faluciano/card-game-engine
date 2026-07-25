// ─── Game Table Screen (web) ───────────────────────────────────────
// Web port of packages/host/src/screens/GameTable.tsx. Renders the
// public "god view" of the game: zones with cards, player info, phase
// indicator, scores, and the end-of-round / game-over overlay. The RN
// `Animated` deal-in and flip animations become CSS keyframes.

import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  Card,
  CardGameState,
  HostAction,
  HostGameState,
  Player,
  UIConfig,
  ZoneState,
} from "@card-engine/shared";
import { useGameOrchestrator } from "../host-logic/use-game-orchestrator.js";
import { Button } from "../components/Button.js";
import { colors } from "../theme.js";

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

export function GameTable({
  state,
  dispatch,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
}): React.JSX.Element {
  useGameOrchestrator(state, dispatch);

  // Guard: must be on game_table with active engine state
  if (state.screen.tag !== "game_table") {
    return (
      <div style={styles.container}>
        <div style={styles.errorText}>Invalid screen state</div>
      </div>
    );
  }

  if (state.engineState === null) {
    return (
      <div style={styles.container}>
        <div style={styles.errorText}>No game in progress</div>
      </div>
    );
  }

  const engineState = state.engineState;
  const tableColor = resolveTableColor(engineState.ruleset.ui);
  const isFinished = engineState.status.kind === "finished";
  const isRoundEnd = engineState.currentPhase === "round_end";

  return (
    <div style={{ ...styles.container, backgroundColor: tableColor }}>
      <StatusBar engineState={engineState} />

      <div style={styles.tableLayout}>
        <SharedZones engineState={engineState} />
        <PlayerZones engineState={engineState} />
        <ScoreBoard engineState={engineState} />
      </div>

      {(isFinished || isRoundEnd) && (
        <ResultsOverlay engineState={engineState} dispatch={dispatch} />
      )}
    </div>
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
    <div style={styles.statusBar}>
      <span style={styles.phaseLabel}>
        Phase: {formatPhaseName(engineState.currentPhase)}
      </span>
      <span style={styles.statusLabel}>{statusLabel}</span>
      {currentPlayer && (
        <span style={styles.turnIndicator}>Turn: {currentPlayer.name}</span>
      )}
      <span style={styles.turnNumber}>Round {engineState.turnNumber}</span>
    </div>
  );
});

// ─── Shared Zones ──────────────────────────────────────────────────

const SharedZones = React.memo(function SharedZones({
  engineState,
}: {
  readonly engineState: CardGameState;
}): React.JSX.Element {
  const sharedZones = useMemo(() => getSharedZones(engineState), [engineState]);

  const activeSuit = engineState.stringVariables?.["active_suit"] ?? "";

  if (sharedZones.length === 0 && !activeSuit) return <></>;

  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>TABLE</div>
      <div style={styles.zonesRow}>
        {sharedZones.map(([name, zone]) => (
          <ZoneDisplay
            key={name}
            name={name}
            zone={zone}
            revealed={isPublicOnTable(engineState, name)}
          />
        ))}
        {activeSuit !== "" && <ActiveSuitIndicator suit={activeSuit} />}
      </div>
    </div>
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
    <div style={styles.section}>
      <div style={styles.sectionTitle}>PLAYERS</div>
      {playerZoneGroups.map(({ player, index, zones, isCurrentTurn }) => {
        const score = engineState.scores[`player_score:${index}`];
        const initial = player.name.trim().charAt(0).toUpperCase() || "?";
        return (
          <div
            key={player.id}
            style={{
              ...styles.playerSection,
              ...(isCurrentTurn ? styles.playerSectionActive : null),
            }}
          >
            <div style={styles.playerHeader}>
              <div
                style={{
                  ...styles.avatar,
                  ...(isCurrentTurn ? styles.avatarActive : null),
                }}
              >
                <span
                  style={{
                    ...styles.avatarText,
                    ...(isCurrentTurn ? styles.avatarTextActive : null),
                  }}
                >
                  {initial}
                </span>
              </div>
              <span
                style={{
                  ...styles.playerLabel,
                  ...(isCurrentTurn ? styles.playerLabelActive : null),
                }}
              >
                {player.name}
              </span>
              {typeof score === "number" && (
                <div style={styles.scoreChip}>
                  <span style={styles.scoreChipText}>{score}</span>
                </div>
              )}
              {isCurrentTurn && (
                <div style={styles.turnBadge}>
                  <span style={styles.turnBadgeText}>TURN</span>
                </div>
              )}
            </div>
            <div style={styles.zonesRow}>
              {zones.map(([name, zone]) => (
                <ZoneDisplay
                  key={name}
                  name={name}
                  zone={zone}
                  revealed={isPublicOnTable(engineState, name)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
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
   * (public visibility) on the shared god-view — e.g. player hands.
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

  if (cards.length > prevCardCountRef.current) {
    // Cards were added — mark the start index of new cards
    newCardStartIndex.current = prevCardCountRef.current;
  } else if (cards.length !== prevCardCountRef.current) {
    // Cards were removed or count changed — reset
    newCardStartIndex.current = -1;
  }
  prevCardCountRef.current = cards.length;

  // Clear the "new" marker once the staggered deal has finished.
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
  const shouldCollapse = allFaceDown && cards.length > STACK_COLLAPSE_THRESHOLD;
  const hasFaceUpCards = cards.some((c) => c.faceUp);
  const shouldShowTopOnly =
    !revealed &&
    !allFaceDown &&
    hasFaceUpCards &&
    cards.length > STACK_COLLAPSE_THRESHOLD &&
    !expanded;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((prev) => !prev)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((prev) => !prev);
        }
      }}
      style={styles.zone}
    >
      <div style={styles.zoneName}>{formatZoneName(name)}</div>
      <div style={styles.cardRow}>
        {cards.length === 0 ? (
          <div style={styles.emptyZone}>
            <span style={styles.emptyZoneText}>Empty</span>
          </div>
        ) : isDiscard ? (
          <DiscardPile topCard={cards[0]!} count={cards.length} />
        ) : shouldCollapse ? (
          <StackedDeck />
        ) : shouldShowTopOnly ? (
          <>
            <FlippableCardView card={cards[0]!} />
            <div style={styles.moreIndicator}>
              <span style={styles.moreIndicatorText}>
                +{cards.length - 1} more
              </span>
            </div>
          </>
        ) : (
          <CappedCardList
            cards={cards}
            newCardStartIndex={newCardStartIndex.current}
          />
        )}
      </div>
    </div>
  );
});

// ─── Stacked Deck (collapsed face-down pile) ──────────────────────

const StackedDeck = React.memo(function StackedDeck(): React.JSX.Element {
  return (
    <div style={styles.stackedDeck}>
      {/* Bottom shadow card */}
      <div
        style={{ ...styles.card, ...styles.cardBack, ...styles.stackShadow2 }}
      />
      {/* Middle shadow card */}
      <div
        style={{ ...styles.card, ...styles.cardBack, ...styles.stackShadow1 }}
      />
      {/* Top card */}
      <div style={{ ...styles.card, ...styles.cardBack, ...styles.stackTop }}>
        <div style={styles.cardBackFrame} />
      </div>
    </div>
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
    <div style={styles.stackedDeck}>
      {count >= 3 && (
        <div
          style={{
            ...styles.card,
            ...styles.cardFace,
            ...styles.stackShadow2,
            opacity: 0.4,
          }}
        />
      )}
      {count >= 2 && (
        <div
          style={{
            ...styles.card,
            ...styles.cardFace,
            ...styles.stackShadow1,
            opacity: 0.7,
          }}
        />
      )}
      {/* Top card — face-up */}
      <div style={styles.stackTop}>
        <FlippableCardView card={topCard} />
      </div>
      <div style={styles.stackBadge}>
        <span style={styles.stackBadgeText}>{count}</span>
      </div>
    </div>
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
    <div style={styles.activeSuitContainer}>
      <div style={styles.activeSuitLabel}>ACTIVE SUIT</div>
      <div style={{ ...styles.activeSuitSymbol, color: suitColor }}>
        {symbol}
      </div>
      <div style={{ ...styles.activeSuitName, color: suitColor }}>
        {suit.charAt(0).toUpperCase() + suit.slice(1)}
      </div>
    </div>
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
  const visibleCards = hiddenCount > 0 ? cards.slice(-MAX_VISIBLE_CARDS) : cards;
  // Adjust the start index for the visible slice
  const visibleOffset = hiddenCount > 0 ? hiddenCount : 0;

  return (
    <>
      {hiddenCount > 0 && (
        <div style={styles.moreIndicator}>
          <span style={styles.moreIndicatorText}>+{hiddenCount} more</span>
        </div>
      )}
      {visibleCards.map((card, i) => {
        const globalIndex = visibleOffset + i;
        const isNewCard =
          newCardStartIndex >= 0 && globalIndex >= newCardStartIndex;

        if (isNewCard) {
          const staggerDelay = (globalIndex - newCardStartIndex) * 80;
          return (
            <AnimatedCardView key={card.id} card={card} delay={staggerDelay} />
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
      <div style={{ ...styles.card, ...styles.cardBack }}>
        <div style={styles.cardBackFrame} />
      </div>
    );
  }

  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;
  const isRed = RED_SUITS.has(card.suit);
  const inkColor = isRed ? colors.suitRed : colors.cardInk;

  return (
    <div style={{ ...styles.card, ...styles.cardFace }}>
      <div style={styles.cardCorner}>
        <div style={{ ...styles.cardRank, color: inkColor }}>{card.rank}</div>
        <div style={{ ...styles.cardSuit, color: inkColor }}>{suitSymbol}</div>
      </div>
      <div style={{ ...styles.cardPip, color: inkColor }}>{suitSymbol}</div>
    </div>
  );
});

// ─── Animated Card View ────────────────────────────────────────────

/**
 * Wraps a CardView with a slide-in + fade-in on mount (CSS `deal-in`),
 * matching the host's Animated dealing effect.
 */
const AnimatedCardView = React.memo(function AnimatedCardView({
  card,
  delay,
}: {
  readonly card: Card;
  readonly delay: number;
}): React.JSX.Element {
  return (
    <div className="deal-in" style={{ animationDelay: `${delay}ms` }}>
      <CardView card={card} />
    </div>
  );
});

// ─── Flippable Card View ───────────────────────────────────────────

/**
 * Runs a half-turn flip when `faceUp` goes false → true, the web
 * equivalent of the host's rotateY interpolation.
 */
const FlippableCardView = React.memo(function FlippableCardView({
  card,
}: {
  readonly card: Card;
}): React.JSX.Element {
  const wasFaceUpRef = useRef(card.faceUp);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (card.faceUp && !wasFaceUpRef.current) {
      setFlipping(true);
      const timer = setTimeout(() => setFlipping(false), 400);
      wasFaceUpRef.current = card.faceUp;
      return () => clearTimeout(timer);
    }
    wasFaceUpRef.current = card.faceUp;
  }, [card.faceUp]);

  return (
    <div className={flipping ? "card-flip" : undefined}>
      <CardView card={card} />
    </div>
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
    <div style={styles.section}>
      <div style={styles.sectionTitle}>SCORES</div>
      <div style={styles.scoreBoard}>
        {scoreEntries.map(([key, score]) => {
          const displayName = resolveScoreLabel(key, engineState.players);
          return (
            <div key={key} style={styles.scoreRow}>
              <span style={styles.scoreName}>{displayName}</span>
              <span style={styles.scoreValue}>{score}</span>
            </div>
          );
        })}
      </div>
    </div>
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
  const isRoundEnd = engineState.currentPhase === "round_end";
  const isFinished = engineState.status.kind === "finished";

  // Guard: only show for round_end or finished
  if (!isRoundEnd && !isFinished) return <></>;

  const backToMenu = (): void => dispatch({ type: "BACK_TO_PICKER" });

  if (isRoundEnd) {
    // ── Round-end view: show per-player results ──
    const npcScores = Object.entries(engineState.scores)
      .filter(
        ([key]) => key.endsWith("_score") && !key.startsWith("player_score:"),
      )
      .map(([key, value]) => ({
        label: key
          .replace(/_score$/, "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        score: value,
      }));

    return (
      <div style={styles.overlay}>
        <div style={styles.overlayCard}>
          <div style={styles.overlayTitle}>ROUND COMPLETE</div>

          {engineState.players.map((player, index) => {
            const handValue = engineState.scores[`player_score:${index}`] ?? 0;
            const result = engineState.scores[`result:${index}`] ?? 0;
            const resultLabel =
              result > 0 ? "WIN" : result < 0 ? "LOSS" : "DRAW";
            const resultColor =
              result > 0
                ? colors.success
                : result < 0
                  ? colors.redAlt
                  : colors.amber;

            return (
              <div key={player.id} style={resultsStyles.playerRow}>
                <span style={resultsStyles.playerName}>{player.name}</span>
                <span style={resultsStyles.handValue}>{handValue}</span>
                <div
                  style={{
                    ...resultsStyles.resultBadge,
                    backgroundColor: resultColor,
                  }}
                >
                  <span style={resultsStyles.resultBadgeText}>
                    {resultLabel}
                  </span>
                </div>
              </div>
            );
          })}

          {npcScores.length > 0 && (
            <>
              <div style={resultsStyles.divider} />
              {npcScores.map(({ label, score }) => (
                <div key={label} style={resultsStyles.npcRow}>
                  <span style={resultsStyles.npcLabel}>{label}</span>
                  <span style={resultsStyles.npcScore}>{score}</span>
                </div>
              ))}
            </>
          )}

          {/* Info text — phones trigger the new round, not the display */}
          <div style={resultsStyles.waitingText}>
            Waiting for players to start new round...
          </div>

          <div style={styles.overlayButtons}>
            <Button
              label="Back to Menu"
              variant="secondary"
              onPress={backToMenu}
              style={styles.overlayButton}
              labelStyle={styles.overlayButtonText}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Finished view ──
  const { winnerId } = engineState.status as {
    readonly winnerId: string | null;
  };
  const winner = winnerId
    ? engineState.players.find((p) => p.id === winnerId)
    : null;

  return (
    <div style={styles.overlay}>
      <div style={styles.overlayCard}>
        <div style={styles.overlayTitle}>GAME OVER</div>
        <div style={styles.overlayWinner}>
          {winner ? `🏆 ${winner.name} wins!` : "It's a draw!"}
        </div>

        <div style={styles.overlayButtons}>
          <Button
            label="Back to Menu"
            variant="secondary"
            onPress={backToMenu}
            style={styles.overlayButton}
            labelStyle={styles.overlayButtonText}
          />
        </div>
      </div>
    </div>
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
 * Determines whether a zone should render face-up on the shared god-view.
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

/** Resolves a score key like "player_score:0" or "result:1" to a label. */
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
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

const CARD_SHADOW = "0 2px 3px rgba(0, 0, 0, 0.35)";

const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.feltDark,
    position: "relative",
    minHeight: 0,
  },
  errorText: {
    color: colors.danger,
    fontSize: 28,
    textAlign: "center",
    marginTop: 48,
    width: "100%",
  },

  // Status bar
  statusBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.tableBgEdge,
    borderBottom: `1px solid ${colors.tableBorder}`,
    padding: "10px 32px",
    gap: 32,
    flexShrink: 0,
  },
  phaseLabel: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: 700,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 22,
  },
  turnIndicator: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: 600,
  },
  turnNumber: {
    color: colors.textMuted,
    fontSize: 20,
    marginLeft: "auto",
  },

  // Table layout
  tableLayout: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    minHeight: 0,
    overflowY: "auto",
  },

  // Sections
  section: {
    width: "100%",
    maxWidth: 1280,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 6,
  },

  // Zone layout
  zonesRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 20,
    width: "100%",
  },
  zone: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `1px solid ${colors.tableBorder}`,
    padding: 10,
    minWidth: 140,
    cursor: "pointer",
    outline: "none",
  },
  zoneName: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyZone: {
    display: "flex",
    width: 52,
    height: 74,
    borderRadius: 8,
    border: `1px dashed ${colors.tableBorder}`,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  emptyZoneText: {
    color: colors.textFaint,
    fontSize: 12,
  },

  // Cards
  card: {
    display: "flex",
    position: "relative",
    width: 52,
    height: 74,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: CARD_SHADOW,
    boxSizing: "border-box",
    flexShrink: 0,
  },
  cardFace: {
    backgroundColor: colors.white,
    border: `1px solid ${colors.cardFaceBorder}`,
  },
  cardBack: {
    backgroundColor: colors.dark,
    border: `1px solid ${colors.goldDim}`,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 5,
  },
  cardBackFrame: {
    flex: 1,
    border: `1px solid ${colors.goldDim}`,
    borderRadius: 4,
  },
  cardCorner: {
    position: "absolute",
    top: 4,
    left: 5,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  cardRank: {
    color: colors.cardInk,
    fontSize: 17,
    fontWeight: 800,
    lineHeight: "18px",
  },
  cardSuit: {
    color: colors.cardInk,
    fontSize: 13,
    lineHeight: "14px",
  },
  cardPip: {
    color: colors.cardInk,
    fontSize: 22,
    opacity: 0.85,
  },

  // Stacked deck (collapsed pile)
  stackedDeck: {
    position: "relative",
    width: 78,
    height: 92,
    flexShrink: 0,
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
    display: "flex",
    backgroundColor: colors.gold,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    boxSizing: "border-box",
  },
  stackBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: 800,
  },

  // Overflow indicator
  moreIndicator: {
    display: "flex",
    height: 72,
    alignItems: "center",
    padding: "0 8px",
  },
  moreIndicatorText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: 700,
  },

  // Active suit indicator
  activeSuitContainer: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `2px solid ${colors.gold}`,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  activeSuitLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeSuitSymbol: {
    fontSize: 36,
    lineHeight: "42px",
  },
  activeSuitName: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 2,
  },

  // Player sections
  playerSection: {
    width: "100%",
    marginBottom: 8,
    padding: 8,
    borderRadius: 14,
    // Longhands, not the `border` shorthand: the active variant overrides only
    // `borderColor`, and React won't re-apply an unchanged shorthand when the
    // longhand is dropped — the old color would stick when the turn moves on.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    boxSizing: "border-box",
  },
  playerSectionActive: {
    backgroundColor: colors.tableSurface,
    borderColor: colors.goldDim,
  },
  playerHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 6,
  },
  avatar: {
    display: "flex",
    width: 34,
    height: 34,
    borderRadius: "50%",
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.tableBorder,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  avatarActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  avatarText: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: 800,
  },
  avatarTextActive: {
    color: colors.black,
  },
  playerLabel: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 600,
  },
  playerLabelActive: {
    color: colors.textBright,
  },
  scoreChip: {
    display: "flex",
    backgroundColor: colors.tableSurfaceRaised,
    border: `1px solid ${colors.tableBorder}`,
    borderRadius: 999,
    padding: "3px 12px",
    minWidth: 34,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  scoreChipText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: 800,
  },
  turnBadge: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    padding: "3px 12px",
  },
  turnBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1,
  },

  // Score board
  scoreBoard: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `1px solid ${colors.tableBorder}`,
    padding: 12,
    minWidth: 420,
  },
  scoreRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "5px 0",
    borderBottom: `1px solid ${colors.tableBorder}`,
  },
  scoreName: {
    color: colors.text,
    fontSize: 22,
  },
  scoreValue: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: 700,
  },

  // Results overlay
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    boxSizing: "border-box",
  },
  overlayCard: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.tableSurface,
    borderRadius: 24,
    border: `1px solid ${colors.tableBorder}`,
    padding: 48,
    alignItems: "center",
    minWidth: 400,
    maxHeight: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
  },
  overlayTitle: {
    color: colors.gold,
    fontSize: 48,
    fontWeight: 800,
    letterSpacing: 3,
    marginBottom: 16,
  },
  overlayWinner: {
    color: colors.textBright,
    fontSize: 32,
    fontWeight: 600,
    marginBottom: 36,
  },
  overlayButtons: {
    display: "flex",
    flexDirection: "row",
    gap: 20,
  },
  overlayButton: {
    borderRadius: 999,
    padding: "18px 40px",
    backgroundColor: colors.tableSurfaceRaised,
  },
  overlayButtonText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 700,
  },
} satisfies Record<string, React.CSSProperties>;

const resultsStyles = {
  playerRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 16,
    marginBottom: 12,
  },
  playerName: {
    color: colors.text,
    fontSize: 28,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  handValue: {
    color: colors.textMuted,
    fontSize: 24,
  },
  resultBadge: {
    borderRadius: 8,
    padding: "6px 16px",
  },
  resultBadgeText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: 700,
  },
  divider: {
    alignSelf: "stretch",
    borderTop: `1px solid ${colors.border}`,
    marginTop: 8,
    paddingTop: 12,
  },
  npcRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
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
    marginBottom: 24,
    textAlign: "center",
  },
} satisfies Record<string, React.CSSProperties>;
