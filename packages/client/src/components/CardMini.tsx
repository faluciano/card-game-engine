// ─── Card Mini ─────────────────────────────────────────────────────
// Compact card display for phone screens.
// Shows rank + suit face-up, patterned back for face-down/hidden cards.
// A null card means it is hidden from this player.

import React from "react";
import type { CSSProperties } from "react";
import type { Card } from "@card-engine/shared";

interface CardMiniProps {
  readonly card: Card | null;
}

const SUIT_SYMBOLS: Readonly<Record<string, string>> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660",
};

const RED_SUITS: ReadonlySet<string> = new Set(["hearts", "diamonds"]);

const baseCardStyle: CSSProperties = {
  width: 56,
  height: 80,
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.2,
  flexShrink: 0,
};

const faceUpStyle: CSSProperties = {
  ...baseCardStyle,
  backgroundColor: "#fff",
  border: "1px solid #ddd",
};

const faceDownStyle: CSSProperties = {
  ...baseCardStyle,
  backgroundColor: "var(--color-card-back)",
  border: "1px solid #1e3f7a",
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.05) 4px, rgba(255,255,255,0.05) 8px)",
};

const rankStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
};

export function CardMini({ card }: CardMiniProps): React.JSX.Element {
  // Null card = hidden from this player by visibility rules.
  // Non-null card = player is allowed to see it (visibility already enforced
  // by createPlayerView). Show face-up regardless of card.faceUp property.
  if (!card) {
    return <div style={faceDownStyle} aria-label="Face-down card" />;
  }

  const isRed = RED_SUITS.has(card.suit);
  const textColor = isRed ? "var(--color-card-red)" : "#1a1a2e";
  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;

  return (
    <div
      style={faceUpStyle}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span style={{ ...rankStyle, color: textColor }}>{card.rank}</span>
      <span style={{ color: textColor }}>{suitSymbol}</span>
    </div>
  );
}
