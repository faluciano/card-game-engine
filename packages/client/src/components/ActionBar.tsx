// ─── Action Bar ────────────────────────────────────────────────────
// Renders action buttons based on the player's valid actions.
// Each ValidAction from the engine carries a name and label.
// Tapping a button sends a GAME_ACTION to the host.
// For play_card actions, requires a selected card from the hand. Actions
// that target another player (e.g. Go Fish "ask") render one button per
// opponent under the action's label.

import type React from "react";
import { useCallback } from "react";
import type { CSSProperties } from "react";
import type { HostAction, PlayerView, PlayerId, ValidAction } from "@card-engine/shared";
import {
  buildGameAction,
  isSuitPickerPhase,
  needsCardSelectionHint,
  otherPlayerTargets,
  targetsOtherPlayer,
  type SelectedCard,
} from "../lib/action-bar.js";
import { SuitPicker } from "./SuitPicker.js";

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
  padding: "14px 24px",
  borderRadius: "var(--radius-pill)",
  border: "none",
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 0.3,
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

const targetGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: "100%",
};

const targetCaptionStyle: CSSProperties = {
  textAlign: "center",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  margin: 0,
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

export function ActionBar({
  playerView,
  validActions,
  playerId,
  sendAction,
  selectedCard = null,
}: ActionBarProps): React.JSX.Element {
  const { isMyTurn } = playerView;

  const handleAction = useCallback(
    (validAction: ValidAction, targetPlayerIndex: number | null = null) => {
      // A missing choice yields null: the button is disabled, but fail safe.
      const action = buildGameAction(validAction, playerId, selectedCard, targetPlayerIndex);
      if (action !== null) sendAction(action);
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

  if (isSuitPickerPhase(validActions)) {
    return (
      <div style={containerStyle}>
        <SuitPicker validActions={validActions} playerId={playerId} sendAction={sendAction} />
      </div>
    );
  }

  const needsCardHint = needsCardSelectionHint(validActions, selectedCard);
  const targets = otherPlayerTargets(playerView.players, playerId);

  return (
    <div style={containerStyle}>
      <div style={buttonsStyle}>
        {validActions.map((action) => {
          if (targetsOtherPlayer(action)) {
            return (
              <div key={action.actionName} style={targetGroupStyle}>
                <p style={targetCaptionStyle}>{action.label}</p>
                <div style={buttonsStyle}>
                  {targets.map(({ index, player }) => (
                    <ActionButton
                      key={player.id}
                      label={player.name}
                      disabled={
                        !action.enabled ||
                        buildGameAction(action, playerId, selectedCard, index) === null
                      }
                      onPress={() => handleAction(action, index)}
                    />
                  ))}
                </div>
              </div>
            );
          }

          const isPlayCard = action.actionName === "play_card";
          const needsSelection = isPlayCard && !selectedCard;
          return (
            <ActionButton
              key={action.actionName}
              label={needsSelection ? "Select a card" : action.label}
              disabled={!action.enabled || buildGameAction(action, playerId, selectedCard) === null}
              onPress={() => handleAction(action)}
            />
          );
        })}
      </div>
      {needsCardHint && <p style={hintStyle}>Tap a card in your hand to select it</p>}
    </div>
  );
}

interface ActionButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

function ActionButton({ label, disabled, onPress }: ActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      style={disabled ? disabledButtonStyle : enabledButtonStyle}
      disabled={disabled}
      onClick={onPress}
      onPointerDown={disabled ? undefined : handlePointerDown}
      onPointerUp={disabled ? undefined : handlePointerUp}
      onPointerLeave={disabled ? undefined : handlePointerUp}
    >
      {label}
    </button>
  );
}
