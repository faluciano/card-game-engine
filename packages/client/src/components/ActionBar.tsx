// ─── Action Bar ────────────────────────────────────────────────────
// Renders action buttons based on the player's valid actions.
// Each ValidAction from the engine carries a name and label.
// Tapping a button sends a GAME_ACTION to the host.
// For play_card actions, requires a selected card from the hand.

import React, { useCallback } from "react";
import type { CSSProperties } from "react";
import type { HostAction, PlayerView, PlayerId, CardInstanceId } from "@card-engine/shared";
import { type ValidAction } from "@card-engine/shared";

/** Tracks which card the player has tapped for a play_card action. */
interface SelectedCard {
  readonly cardId: CardInstanceId;
  readonly zoneName: string;
}

interface ActionBarProps {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly playerId: PlayerId;
  readonly sendAction: (action: HostAction) => void;
  /** The currently selected card, needed for play_card actions. */
  readonly selectedCard?: SelectedCard | null;
}

const containerStyle: CSSProperties = {
  flexShrink: 0,
  padding: "8px 0",
};

const buttonsStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "center",
};

const buttonBaseStyle: CSSProperties = {
  minHeight: 56,
  minWidth: 100,
  padding: "12px 20px",
  borderRadius: 12,
  border: "none",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  transition: "transform 0.1s ease-out",
  flex: "1 1 auto",
  maxWidth: 200,
};

const waitingStyle: CSSProperties = {
  textAlign: "center",
  fontSize: 14,
  color: "var(--color-text-muted)",
  animation: "pulse 1.5s ease-in-out infinite",
  padding: "16px 0",
};

const disabledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: "var(--color-accent-dim)",
  color: "var(--color-text-muted)",
  cursor: "not-allowed",
  opacity: 0.6,
};

const enabledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
};

const hintStyle: CSSProperties = {
  textAlign: "center",
  fontSize: 12,
  color: "var(--color-text-muted)",
  padding: "4px 0 0",
};

function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
  e.currentTarget.style.transform = "scale(0.95)";
}

function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>): void {
  e.currentTarget.style.transform = "scale(1)";
}

/** Default target zone when a play_card action doesn't specify one. */
const DEFAULT_PLAY_TARGET_ZONE = "discard";

export function ActionBar({
  playerView,
  validActions,
  playerId,
  sendAction,
  selectedCard = null,
}: ActionBarProps): React.JSX.Element {
  const { isMyTurn } = playerView;

  const handleAction = useCallback(
    (actionName: string) => {
      // play_card requires card selection — construct the proper action shape
      if (actionName === "play_card") {
        if (!selectedCard) return; // guard: button should be disabled, but fail safe

        sendAction({
          type: "GAME_ACTION",
          action: {
            kind: "play_card",
            playerId,
            cardId: selectedCard.cardId,
            fromZone: selectedCard.zoneName,
            toZone: DEFAULT_PLAY_TARGET_ZONE,
          },
        });
        return;
      }

      // All other actions are declarations
      sendAction({
        type: "GAME_ACTION",
        action: { kind: "declare", playerId, declaration: actionName },
      });
    },
    [sendAction, playerId, selectedCard],
  );

  if (!isMyTurn) {
    return (
      <div style={containerStyle}>
        <p style={waitingStyle}>Waiting for other player...</p>
      </div>
    );
  }

  if (validActions.length === 0) {
    return (
      <div style={containerStyle}>
        <p style={waitingStyle}>No actions available</p>
      </div>
    );
  }

  const needsCardHint = validActions.some(
    (a) => a.actionName === "play_card" && a.enabled && !selectedCard,
  );

  return (
    <div style={containerStyle}>
      <div style={buttonsStyle}>
        {validActions.map((action) => {
          const isPlayCard = action.actionName === "play_card";
          const needsSelection = isPlayCard && !selectedCard;
          const isDisabled = !action.enabled || needsSelection;

          const style = isDisabled ? disabledButtonStyle : enabledButtonStyle;

          const label = isPlayCard && needsSelection
            ? "Select a card"
            : action.label;

          return (
            <button
              key={action.actionName}
              type="button"
              style={style}
              disabled={isDisabled}
              onClick={() => handleAction(action.actionName)}
              onPointerDown={isDisabled ? undefined : handlePointerDown}
              onPointerUp={isDisabled ? undefined : handlePointerUp}
              onPointerLeave={isDisabled ? undefined : handlePointerUp}
            >
              {label}
            </button>
          );
        })}
      </div>
      {needsCardHint && (
        <p style={hintStyle}>Tap a card in your hand to select it</p>
      )}
    </div>
  );
}
