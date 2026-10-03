// ─── Suit Picker ───────────────────────────────────────────────────
// Visual suit selector with large tappable icons.
// Shown during the choose_suit phase in Crazy Eights and similar games.
// Falls back to regular ActionBar buttons for non-suit actions.

import type React from "react";
import { useCallback } from "react";
import type { CSSProperties } from "react";
import type { HostAction, PlayerId } from "@card-engine/shared";
import type { ValidAction } from "@card-engine/shared";
import { formatSuitName, isRedSuit, suitSymbol } from "@card-engine/host-core/catalog";

interface SuitPickerProps {
  readonly validActions: readonly ValidAction[];
  readonly playerId: PlayerId;
  readonly sendAction: (action: HostAction) => void;
}

interface SuitDisplay {
  readonly symbol: string;
  readonly label: string;
  readonly red: boolean;
}

/** Grid order: top-left, top-right, bottom-left, bottom-right. */
const SUITS: readonly string[] = ["hearts", "diamonds", "clubs", "spades"];

const SUIT_ACTIONS: Readonly<Record<string, SuitDisplay>> = Object.fromEntries(
  SUITS.map((suit) => [
    `choose_${suit}`,
    { symbol: suitSymbol(suit), label: formatSuitName(suit), red: isRedSuit(suit) },
  ]),
);

const SUIT_ORDER: readonly string[] = SUITS.map((suit) => `choose_${suit}`);

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
  justifyItems: "center",
  padding: "8px 0",
};

const buttonBase: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: "50%",
  cursor: "pointer",
  transition: "transform 0.1s ease-out",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 32,
  lineHeight: 1,
  padding: 0,
  background: "none",
};

const redButtonStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "rgba(231, 76, 60, 0.15)",
  border: "2px solid var(--color-card-red)",
  color: "var(--color-card-red)",
};

const blackButtonStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "rgba(234, 234, 234, 0.1)",
  border: "2px solid var(--color-card-black)",
  color: "var(--color-card-black)",
};

const cellStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  lineHeight: 1,
};

function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>): void {
  e.currentTarget.style.transform = "scale(0.95)";
}

function handlePointerUp(e: React.PointerEvent<HTMLButtonElement>): void {
  e.currentTarget.style.transform = "scale(1)";
}

export function SuitPicker({
  validActions,
  playerId,
  sendAction,
}: SuitPickerProps): React.JSX.Element {
  const handleChoose = useCallback(
    (actionName: string) => {
      sendAction({
        type: "GAME_ACTION",
        action: { kind: "declare", playerId, declaration: actionName },
      });
    },
    [sendAction, playerId],
  );

  // Build a lookup for enabled state from validActions
  const actionMap = new Map(validActions.map((a) => [a.actionName, a]));

  return (
    <div style={gridStyle}>
      {SUIT_ORDER.map((actionName) => {
        const suit = SUIT_ACTIONS[actionName];
        if (!suit) return null;

        const action = actionMap.get(actionName);
        const isDisabled = !action?.enabled;
        const style = suit.red ? redButtonStyle : blackButtonStyle;

        return (
          <div key={actionName} style={cellStyle}>
            <button
              type="button"
              style={isDisabled ? { ...style, opacity: 0.4, cursor: "not-allowed" } : style}
              disabled={isDisabled}
              onClick={() => handleChoose(actionName)}
              onPointerDown={isDisabled ? undefined : handlePointerDown}
              onPointerUp={isDisabled ? undefined : handlePointerUp}
              onPointerLeave={isDisabled ? undefined : handlePointerUp}
              aria-label={suit.label}
            >
              {suit.symbol}
            </button>
            <span style={labelStyle}>{suit.label}</span>
          </div>
        );
      })}
    </div>
  );
}
