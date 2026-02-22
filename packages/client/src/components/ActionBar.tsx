// ─── Action Bar ────────────────────────────────────────────────────
// Renders action buttons based on the player's valid actions.
// Each ValidAction from the engine carries a name and label.
// Tapping a button sends a GAME_ACTION to the host.

import React, { useCallback } from "react";
import type { CSSProperties } from "react";
import type { HostAction, PlayerView, PlayerId } from "@card-engine/shared";
import { type ValidAction } from "@card-engine/shared";

interface ActionBarProps {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly playerId: PlayerId;
  readonly sendAction: (action: HostAction) => void;
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
}: ActionBarProps): React.JSX.Element {
  const { isMyTurn } = playerView;

  const handleAction = useCallback(
    (actionName: string) => {
      sendAction({
        type: "GAME_ACTION",
        action: { kind: "declare", playerId, declaration: actionName },
      });
    },
    [sendAction, playerId],
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

  return (
    <div style={containerStyle}>
      <div style={buttonsStyle}>
        {validActions.map((action) => {
          const style = action.enabled
            ? enabledButtonStyle
            : disabledButtonStyle;

          return (
            <button
              key={action.actionName}
              type="button"
              style={style}
              disabled={!action.enabled}
              onClick={() => handleAction(action.actionName)}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
