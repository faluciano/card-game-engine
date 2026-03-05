// ─── Game Info ─────────────────────────────────────────────────────
// Compact status bar showing phase, turn number, score, and turn indicator.

import React from "react";
import type { CSSProperties } from "react";
import type { PlayerView } from "@card-engine/shared";
import { ActiveSuitBadge } from "./ActiveSuitBadge.js";

interface GameInfoProps {
  readonly playerView: PlayerView;
  /** When true, plays a more noticeable pulse animation on the turn badge. */
  readonly turnPulse?: boolean;
}

const containerStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 12px",
  borderRadius: 10,
  backgroundColor: "var(--color-surface)",
  fontSize: 13,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  flex: 1,
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const valueStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const turnIndicatorStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  animation: "pulse 1.5s ease-in-out infinite",
};

const turnIndicatorPulseStyle: CSSProperties = {
  ...turnIndicatorStyle,
  animation: "turnPulseNotify 1s ease-out, pulse 1.5s ease-in-out 1s infinite",
};

/**
 * Formats a phase name for display.
 * "player_turn" -> "Player Turn"
 */
function formatPhaseName(phase: string): string {
  return phase
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function GameInfo({
  playerView,
  turnPulse = false,
}: GameInfoProps): React.JSX.Element {
  const { currentPhase, turnNumber, scores, isMyTurn, myPlayerId, stringVariables } =
    playerView;

  const myScore = scores[myPlayerId] ?? 0;
  const activeSuit = stringVariables?.active_suit ?? "";

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <span style={labelStyle}>Phase</span>
        <span style={valueStyle}>{formatPhaseName(currentPhase)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Turn</span>
        <span style={valueStyle}>{turnNumber}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Score</span>
        <span style={{ ...valueStyle, color: "var(--color-warning)" }}>
          {myScore}
        </span>
      </div>
      {isMyTurn && (
        <div style={turnPulse ? turnIndicatorPulseStyle : turnIndicatorStyle}>
          Your Turn
        </div>
      )}
      <ActiveSuitBadge activeSuit={activeSuit} />
    </div>
  );
}
