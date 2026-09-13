// ─── Game Table Screen (web) ───────────────────────────────────────
// Thin DOM renderer over `useGameTableModel` from host-core, mirroring
// packages/host/src/screens/GameTable.tsx: zones with cards, player
// info, phase indicator, scores, and the end-of-round / game-over
// overlay. The host's RN `Animated` deal-in and flip become CSS
// keyframes driven by the shared timing constants.

import React, { useState } from "react";
import type { Card, HostAction, HostGameState } from "@card-engine/shared";
import {
  DEAL_DURATION_MS,
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
import { Button } from "../components/Button.js";

// ─── Component ─────────────────────────────────────────────────────

export function GameTable({
  state,
  dispatch,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
}): React.JSX.Element {
  const model = useGameTableModel(state, dispatch);

  // Guard: must be on game_table with active engine state
  if (model.kind !== "table") {
    return (
      <div style={styles.container}>
        <div style={styles.errorText}>{model.message}</div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, backgroundColor: model.tableColor }}>
      <StatusBar model={model.statusBar} />

      <div style={styles.tableLayout}>
        {model.showSharedSection && (
          <SharedZones zones={model.sharedZones} activeSuit={model.activeSuit} />
        )}
        <PlayerZones sections={model.playerSections} />
        <ScoreBoard rows={model.scoreRows} />
      </div>

      {model.overlay && <ResultsOverlay overlay={model.overlay} onBackToMenu={model.backToMenu} />}
    </div>
  );
}

// ─── Status Bar ────────────────────────────────────────────────────

const StatusBar = React.memo(function StatusBar({
  model,
}: {
  readonly model: StatusBarModel;
}): React.JSX.Element {
  return (
    <div style={styles.statusBar}>
      <span style={styles.phaseLabel}>Phase: {model.phaseLabel}</span>
      <span style={styles.statusLabel}>{model.statusLabel}</span>
      {model.currentPlayerName !== null && (
        <span style={styles.turnIndicator}>Turn: {model.currentPlayerName}</span>
      )}
      <span style={styles.turnNumber}>Round {model.turnNumber}</span>
    </div>
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
    <div style={styles.section}>
      <div style={styles.sectionTitle}>TABLE</div>
      <div style={styles.zonesRow}>
        {zones.map((view) => (
          <ZoneDisplay key={view.name} view={view} />
        ))}
        {activeSuit && <ActiveSuitIndicator model={activeSuit} />}
      </div>
    </div>
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
    <div style={styles.section}>
      <div style={styles.sectionTitle}>PLAYERS</div>
      {sections.map(({ player, zoneViews, isCurrentTurn, score, initial }) => (
        <div
          key={player.id}
          style={{
            ...styles.playerSection,
            ...(isCurrentTurn ? styles.playerSectionActive : null),
          }}
        >
          <div style={styles.playerHeader}>
            <div style={{ ...styles.avatar, ...(isCurrentTurn ? styles.avatarActive : null) }}>
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
            {score !== null && (
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
            {zoneViews.map((view) => (
              <ZoneDisplay key={view.name} view={view} />
            ))}
          </div>
        </div>
      ))}
    </div>
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
    <button
      type="button"
      onClick={toggleExpanded}
      style={{
        // Button reset; border, padding and cursor come from styles.zone.
        background: "none",
        margin: 0,
        font: "inherit",
        color: "inherit",
        textAlign: "inherit",
        ...styles.zone,
      }}
    >
      <div style={styles.zoneName}>{formatZoneName(view.name)}</div>
      <div style={styles.cardRow}>
        {mode === "empty" ? (
          <div style={styles.emptyZone}>
            <span style={styles.emptyZoneText}>Empty</span>
          </div>
        ) : mode === "discard" ? (
          <DiscardPile topCard={cards[0]!} count={cards.length} />
        ) : mode === "stack" ? (
          <StackedDeck />
        ) : mode === "top_only" ? (
          <>
            <FlippableCardView card={cards[0]!} />
            <div style={styles.moreIndicator}>
              <span style={styles.moreIndicatorText}>+{cards.length - 1} more</span>
            </div>
          </>
        ) : (
          <CappedCardList cards={cards} newCardStartIndex={newCardStartIndex} />
        )}
      </div>
    </button>
  );
});

// ─── Stacked Deck (collapsed face-down pile) ──────────────────────

const StackedDeck = React.memo(function StackedDeck(): React.JSX.Element {
  return (
    <div style={styles.stackedDeck}>
      {/* Bottom shadow card */}
      <div style={{ ...styles.card, ...styles.cardBack, ...styles.stackShadow2 }} />
      {/* Middle shadow card */}
      <div style={{ ...styles.card, ...styles.cardBack, ...styles.stackShadow1 }} />
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
        <div style={{ ...styles.card, ...styles.cardFace, ...styles.stackShadow2, opacity: 0.4 }} />
      )}
      {count >= 2 && (
        <div style={{ ...styles.card, ...styles.cardFace, ...styles.stackShadow1, opacity: 0.7 }} />
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
  model,
}: {
  readonly model: ActiveSuitModel;
}): React.JSX.Element {
  return (
    <div style={styles.activeSuitContainer}>
      <div style={styles.activeSuitLabel}>ACTIVE SUIT</div>
      <div style={{ ...styles.activeSuitSymbol, color: model.color }}>{model.symbol}</div>
      <div style={{ ...styles.activeSuitName, color: model.color }}>{model.name}</div>
    </div>
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
        <div style={styles.moreIndicator}>
          <span style={styles.moreIndicatorText}>+{hiddenCount} more</span>
        </div>
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
      <div style={{ ...styles.card, ...styles.cardBack }}>
        <div style={styles.cardBackFrame} />
      </div>
    );
  }

  const symbol = suitSymbol(card.suit);
  const inkColor = cardInkColor(card);

  return (
    <div style={{ ...styles.card, ...styles.cardFace }}>
      <div style={styles.cardCorner}>
        <div style={{ ...styles.cardRank, color: inkColor }}>{card.rank}</div>
        <div style={{ ...styles.cardSuit, color: inkColor }}>{symbol}</div>
      </div>
      <div style={{ ...styles.cardPip, color: inkColor }}>{symbol}</div>
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
    <div
      className="deal-in"
      style={{ animationDelay: `${delay}ms`, animationDuration: `${DEAL_DURATION_MS}ms` }}
    >
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
  const [flipping, setFlipping] = useState(false);

  useFlipOnReveal(card.faceUp, () => {
    setFlipping(true);
    const timer = setTimeout(() => setFlipping(false), FLIP_DURATION_MS);
    return () => clearTimeout(timer);
  });

  return (
    <div
      className={flipping ? "card-flip" : undefined}
      style={flipping ? { animationDuration: `${FLIP_DURATION_MS}ms` } : undefined}
    >
      <CardView card={card} />
    </div>
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
    <div style={styles.section}>
      <div style={styles.sectionTitle}>SCORES</div>
      <div style={styles.scoreBoard}>
        {rows.map(({ key, label, score }) => (
          <div key={key} style={styles.scoreRow}>
            <span style={styles.scoreName}>{label}</span>
            <span style={styles.scoreValue}>{score}</span>
          </div>
        ))}
      </div>
    </div>
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
  const backButton = (
    <div style={styles.overlayButtons}>
      <Button
        label="Back to Menu"
        variant="secondary"
        onPress={onBackToMenu}
        style={styles.overlayButton}
        labelStyle={styles.overlayButtonText}
      />
    </div>
  );

  if (overlay.kind === "round_end") {
    // ── Round-end view: show per-player results ──
    return (
      <div style={styles.overlay}>
        <div style={styles.overlayCard}>
          <div style={styles.overlayTitle}>ROUND COMPLETE</div>

          {overlay.players.map((row) => (
            <div key={row.playerId} style={resultsStyles.playerRow}>
              <span style={resultsStyles.playerName}>{row.name}</span>
              <span style={resultsStyles.handValue}>{row.handValue}</span>
              <div style={{ ...resultsStyles.resultBadge, backgroundColor: row.resultColor }}>
                <span style={resultsStyles.resultBadgeText}>{row.resultLabel}</span>
              </div>
            </div>
          ))}

          {overlay.npcScores.length > 0 && (
            <>
              <div style={resultsStyles.divider} />
              {overlay.npcScores.map(({ label, score }) => (
                <div key={label} style={resultsStyles.npcRow}>
                  <span style={resultsStyles.npcLabel}>{label}</span>
                  <span style={resultsStyles.npcScore}>{score}</span>
                </div>
              ))}
            </>
          )}

          {/* Info text — phones trigger the new round, not the display */}
          <div style={resultsStyles.waitingText}>Waiting for players to start new round...</div>

          {backButton}
        </div>
      </div>
    );
  }

  // ── Finished view ──
  return (
    <div style={styles.overlay}>
      <div style={styles.overlayCard}>
        <div style={styles.overlayTitle}>GAME OVER</div>
        <div style={styles.overlayWinner}>
          {overlay.winnerName !== null ? `🏆 ${overlay.winnerName} wins!` : "It's a draw!"}
        </div>

        {backButton}
      </div>
    </div>
  );
});

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
