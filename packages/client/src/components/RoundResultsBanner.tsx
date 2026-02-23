// ─── Round Results Banner ───────────────────────────────────────────
// Full-screen overlay shown on the phone when a blackjack round ends.
// Displays the result (win/push/loss), score summary, and a button
// to start a new round.

import React from "react";
import type { CSSProperties } from "react";

interface RoundResultsBannerProps {
  readonly result: number;
  readonly playerScore: number;
  readonly dealerScore: number;
  readonly onNewRound: () => void;
}

// ─── Result configuration ──────────────────────────────────────────

interface ResultConfig {
  readonly emoji: string;
  readonly label: string;
  readonly color: string;
}

function getResultConfig(result: number): ResultConfig {
  if (result > 0) return { emoji: "🎉", label: "You Win!", color: "#4caf50" };
  if (result < 0) return { emoji: "💔", label: "You Lose", color: "#f44336" };
  return { emoji: "🤝", label: "Push", color: "#ffc107" };
}

// ─── Styles ────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(0,0,0,0.85)",
  zIndex: 1000,
  animation: "fadeIn 0.3s ease-out",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 20,
  padding: "32px 40px",
  borderRadius: 16,
  backgroundColor: "var(--color-surface, #1e1e1e)",
  minWidth: 260,
  maxWidth: 340,
};

const emojiStyle: CSSProperties = {
  fontSize: 48,
  lineHeight: 1,
};

const scoreSummaryStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  fontSize: 15,
  color: "var(--color-text-muted, #aaa)",
};

const buttonStyle: CSSProperties = {
  minHeight: 52,
  minWidth: 180,
  padding: "14px 28px",
  borderRadius: 12,
  border: "none",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  transition: "transform 0.1s ease-out",
  marginTop: 4,
};

// ─── Component ─────────────────────────────────────────────────────

function formatScore(label: string, score: number): string {
  return score > 21 ? `${label}: ${score} (Busted)` : `${label}: ${score}`;
}

export function RoundResultsBanner({
  result,
  playerScore,
  dealerScore,
  onNewRound,
}: RoundResultsBannerProps): React.JSX.Element {
  const config = getResultConfig(result);

  const resultLabelStyle: CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    color: config.color,
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <span style={emojiStyle}>{config.emoji}</span>
        <span style={resultLabelStyle}>{config.label}</span>
        <div style={scoreSummaryStyle}>
          <span>{formatScore("Your Hand", playerScore)}</span>
          <span>{formatScore("Dealer", dealerScore)}</span>
        </div>
        <button
          type="button"
          style={buttonStyle}
          onClick={onNewRound}
          onPointerDown={(e) => {
            e.currentTarget.style.transform = "scale(0.95)";
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
          onPointerLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          New Round
        </button>
      </div>
    </div>
  );
}
