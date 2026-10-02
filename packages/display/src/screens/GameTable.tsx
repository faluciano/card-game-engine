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
import { resultsStyles, styles } from "./GameTable.styles.js";

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
