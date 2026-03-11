// ─── Playing Screen ────────────────────────────────────────────────
// Main gameplay screen composing GameInfo, HandViewer, and ActionBar.
// Receives the player's view and a function to send actions to the host.
// Manages card selection state for play_card actions.
// Shared zones (discard, deck) are rendered inline with compact displays
// instead of showing every card — discard shows only the top card with
// a tap-to-expand modal, deck shows a face-down card with count badge.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Card, PlayerView, HostAction, CardInstanceId } from "@card-engine/shared";
import { type ValidAction } from "@card-engine/shared";
import { GameInfo } from "../components/GameInfo.js";
import { HandViewer } from "../components/HandViewer.js";
import { ActionBar } from "../components/ActionBar.js";
import { CardMini } from "../components/CardMini.js";
import { RoundResultsBanner } from "../components/RoundResultsBanner.js";
import { OpponentInfo } from "../components/OpponentInfo.js";

/** Zone names that get special compact rendering instead of full card lists. */
const COMPACT_ZONE_NAMES: ReadonlySet<string> = new Set([
  "discard",
  "draw_pile",
  "deck",
]);

/** Tracks which card the player has tapped for a play_card action. */
interface SelectedCard {
  readonly cardId: CardInstanceId;
  readonly zoneName: string;
}

interface PlayingScreenProps {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly sendAction: (action: HostAction) => void;
  readonly playableCardIds: ReadonlySet<string>;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  padding: 16,
  gap: 12,
  animation: "fadeIn 0.3s ease-out",
};

// ─── Compact zone styles ──────────────────────────────────────────

const compactZonesRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  justifyContent: "center",
  flexShrink: 0,
};

const compactZoneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const compactZoneLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const compactCardWrapperStyle: CSSProperties = {
  position: "relative",
  cursor: "pointer",
};

const countBadgeStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  minWidth: 20,
  height: 20,
  borderRadius: 10,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
};

const viewAllStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-accent)",
  cursor: "pointer",
  textDecoration: "underline",
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: "inherit",
};

// ─── Discard modal styles ─────────────────────────────────────────

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  animation: "fadeIn 0.15s ease-out",
};

const modalContentStyle: CSSProperties = {
  backgroundColor: "var(--color-surface)",
  borderRadius: 12,
  padding: 16,
  maxWidth: "90vw",
  maxHeight: "70vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const modalTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const modalCloseStyle: CSSProperties = {
  background: "none",
  border: "1px solid var(--color-text-muted)",
  borderRadius: 6,
  color: "var(--color-text)",
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const modalCardsGridStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  justifyContent: "center",
};

/**
 * Formats a zone name for display.
 * "draw_pile" -> "Draw Pile", "discard" -> "Discard"
 */
function formatZoneName(zoneName: string): string {
  const base = zoneName.replace(/:\d+$/, "");
  return base
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Returns true when any valid action requires card selection. */
function hasPlayCardAction(actions: readonly ValidAction[]): boolean {
  return actions.some((a) => a.actionName === "play_card");
}

export function PlayingScreen({
  playerView,
  validActions,
  sendAction,
  playableCardIds,
}: PlayingScreenProps): React.JSX.Element {
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);
  const [discardModalOpen, setDiscardModalOpen] = useState(false);

  // ─── Turn notification: detect false → true transition ──────────
  const prevIsMyTurnRef = useRef<boolean>(playerView.isMyTurn);
  const [turnPulse, setTurnPulse] = useState(false);

  useEffect(() => {
    const wasMyTurn = prevIsMyTurnRef.current;
    prevIsMyTurnRef.current = playerView.isMyTurn;

    if (!wasMyTurn && playerView.isMyTurn) {
      // Haptic feedback: double-pulse vibration pattern
      navigator.vibrate?.([100, 50, 100]);
      // Trigger pulse animation for ~2s
      setTurnPulse(true);
      const timer = setTimeout(() => setTurnPulse(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [playerView.isMyTurn]);

  // Clear selection when the set of available actions changes
  // (e.g., after submitting an action, turn change, phase change).
  const actionFingerprint = validActions
    .map((a) => a.actionName)
    .sort()
    .join(",");
  useEffect(() => {
    setSelectedCard(null);
  }, [actionFingerprint]);

  const handleCardSelect = useCallback(
    (cardId: CardInstanceId, zoneName: string) => {
      setSelectedCard((prev) =>
        prev?.cardId === cardId ? null : { cardId, zoneName },
      );
    },
    [],
  );

  const handleSendAction = useCallback(
    (action: HostAction) => {
      sendAction(action);
      setSelectedCard(null);
    },
    [sendAction],
  );

  // ─── Separate compact zones from the playerView for HandViewer ──
  // HandViewer should not render discard/deck zones; we handle them here.
  const filteredPlayerView = useMemo<PlayerView>(() => {
    const filteredZones: Record<string, (typeof playerView.zones)[string]> = {};
    for (const [name, zone] of Object.entries(playerView.zones)) {
      if (!COMPACT_ZONE_NAMES.has(name)) {
        filteredZones[name] = zone;
      }
    }
    return { ...playerView, zones: filteredZones };
  }, [playerView]);

  // Extract compact zone data
  const discardZone = playerView.zones["discard"];
  const deckZone =
    playerView.zones["draw_pile"] ?? playerView.zones["deck"];
  const deckZoneName =
    playerView.zones["draw_pile"] != null ? "draw_pile" : "deck";

  // Discard: visible (non-null) cards — index 0 is the most recently played card
  const discardCards = useMemo<readonly Card[]>(
    () =>
      discardZone?.cards.filter((c): c is Card => c !== null) ?? [],
    [discardZone],
  );
  const discardTopCard =
    discardCards.length > 0
      ? discardCards[0]!
      : null;

  const isRoundEnd = playerView.currentPhase === "round_end";
  const myResult = playerView.scores[`result:${playerView.myPlayerId}`] ?? 0;
  const myScore = playerView.scores[playerView.myPlayerId] ?? 0;

  // Dynamically find NPC/opponent scores (any key ending with "_score" that isn't a player score)
  const npcScores = Object.entries(playerView.scores)
    .filter(([key]) => key.endsWith("_score"))
    .map(([key, value]) => ({
      label: key.replace(/_score$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      score: value,
    }));

  // Only enable card selection when a play_card action is available
  const showCardSelection = hasPlayCardAction(validActions);

  const hasCompactZones =
    (discardZone != null && discardZone.cardCount > 0) ||
    (deckZone != null && deckZone.cardCount > 0);

  return (
    <div style={containerStyle}>
      <GameInfo playerView={playerView} turnPulse={turnPulse} />
      <OpponentInfo playerView={playerView} />

      {/* ─── Compact shared zones: discard (top card) + deck (count) ── */}
      {hasCompactZones && (
        <div style={compactZonesRowStyle}>
          {/* Discard pile: top card with count badge */}
          {discardZone != null && discardZone.cardCount > 0 && (
            <div style={compactZoneStyle}>
              <span style={compactZoneLabelStyle}>
                {formatZoneName("discard")}
              </span>
              <div
                style={compactCardWrapperStyle}
                role="button"
                tabIndex={0}
                aria-label={`Discard pile, ${discardZone.cardCount} cards. Tap to view all.`}
                onClick={() => setDiscardModalOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDiscardModalOpen(true);
                  }
                }}
              >
                {discardTopCard != null ? (
                  <CardMini card={discardTopCard} emphasized />
                ) : (
                  <CardMini card={null} />
                )}
                <span style={countBadgeStyle}>
                  {discardZone.cardCount}
                </span>
              </div>
              {discardCards.length > 1 && (
                <button
                  type="button"
                  style={viewAllStyle}
                  onClick={() => setDiscardModalOpen(true)}
                >
                  View all
                </button>
              )}
            </div>
          )}

          {/* Deck / Draw pile: face-down card with count badge */}
          {deckZone != null && deckZone.cardCount > 0 && (
            <div style={compactZoneStyle}>
              <span style={compactZoneLabelStyle}>
                {formatZoneName(deckZoneName)}
              </span>
              <div style={{ position: "relative" }}>
                <CardMini card={null} />
                <span style={countBadgeStyle}>{deckZone.cardCount}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <HandViewer
        playerView={filteredPlayerView}
        onCardSelect={showCardSelection ? handleCardSelect : undefined}
        selectedCardId={selectedCard?.cardId}
        playableCardIds={playableCardIds}
      />
      <ActionBar
        playerView={playerView}
        validActions={validActions}
        playerId={playerView.myPlayerId}
        sendAction={handleSendAction}
        selectedCard={selectedCard}
      />
      {isRoundEnd && (
        <RoundResultsBanner
          result={myResult}
          playerScore={myScore}
          opponentScores={npcScores}
          onNewRound={() => {
            // Find the first available declare action for this phase
            // instead of hardcoding a declaration name.
            const declareAction = validActions.find(
              (a) => a.actionName !== "play_card",
            );
            if (!declareAction) return;
            handleSendAction({
              type: "GAME_ACTION",
              action: {
                kind: "declare",
                playerId: playerView.myPlayerId,
                declaration: declareAction.actionName,
              },
            });
          }}
        />
      )}

      {/* ─── Discard pile modal ─────────────────────────────────────── */}
      {discardModalOpen && (
        <div
          style={modalOverlayStyle}
          role="dialog"
          aria-label="Discard pile"
          aria-modal="true"
          onClick={(e) => {
            // Close on backdrop click (not on content click)
            if (e.target === e.currentTarget) {
              setDiscardModalOpen(false);
            }
          }}
        >
          <div style={modalContentStyle}>
            <div style={modalHeaderStyle}>
              <span style={modalTitleStyle}>
                Discard Pile ({discardCards.length})
              </span>
              <button
                type="button"
                style={modalCloseStyle}
                onClick={() => setDiscardModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div style={modalCardsGridStyle}>
              {discardCards.map((card, index) => (
                <CardMini
                  key={card.id}
                  card={card}
                  emphasized={index === 0}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
