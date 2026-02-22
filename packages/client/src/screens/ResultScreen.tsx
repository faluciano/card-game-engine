// ─── Result Screen ─────────────────────────────────────────────────
// Game over screen showing winner status and final scores.

import React from "react";
import type { CSSProperties } from "react";
import type { PlayerView } from "@card-engine/shared";

interface ResultScreenProps {
  readonly playerView: PlayerView;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
  gap: 16,
  animation: "fadeIn 0.5s ease-out",
};

const titleStyle: CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
};

const resultStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const scoreContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: "100%",
  maxWidth: 280,
  marginTop: 8,
};

const scoreRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 12px",
  borderRadius: 8,
  backgroundColor: "var(--color-surface)",
};

const scoreNameStyle: CSSProperties = {
  fontWeight: 600,
};

const scoreValueStyle: CSSProperties = {
  fontWeight: 700,
  color: "var(--color-warning)",
};

const waitingStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--color-text-muted)",
  animation: "pulse 1.5s ease-in-out infinite",
  marginTop: 8,
};

export function ResultScreen({
  playerView,
}: ResultScreenProps): React.JSX.Element {
  const { status, players, scores, myPlayerId } = playerView;
  const winnerId = status.kind === "finished" ? status.winnerId : null;
  const isWinner = winnerId === myPlayerId;
  const winnerName = winnerId
    ? (players.find((p) => p.id === winnerId)?.name ?? "Unknown")
    : null;

  const resultColor = isWinner
    ? "var(--color-success)"
    : winnerId
      ? "var(--color-danger)"
      : "var(--color-text-muted)";

  const resultText = isWinner
    ? "You Win!"
    : winnerName
      ? `${winnerName} Wins`
      : "Draw";

  const hasScores = Object.keys(scores).length > 0;

  return (
    <div style={containerStyle}>
      <p style={titleStyle}>Game Over</p>

      <p style={{ ...resultStyle, color: resultColor }}>{resultText}</p>

      {hasScores && (
        <>
          <p style={labelStyle}>Final Scores</p>
          <div style={scoreContainerStyle}>
            {players.map((player) => (
              <div
                key={player.id}
                style={{
                  ...scoreRowStyle,
                  border:
                    player.id === myPlayerId
                      ? "1px solid var(--color-accent)"
                      : "1px solid transparent",
                }}
              >
                <span style={scoreNameStyle}>
                  {player.name}
                  {player.id === myPlayerId ? " (you)" : ""}
                </span>
                <span style={scoreValueStyle}>
                  {scores[player.id] ?? 0}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p style={waitingStyle}>Next round starting soon...</p>
    </div>
  );
}
