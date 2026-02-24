// ─── Card Mini ─────────────────────────────────────────────────────
// Compact card display for phone screens.
// Shows rank + suit face-up, patterned back for face-down/hidden cards.
// A null card means it is hidden from this player.
// When onSelect is provided, cards become interactive with selection state.

import React, { useCallback } from "react";
import type { CSSProperties } from "react";
import type { Card, CardInstanceId } from "@card-engine/shared";

interface CardMiniProps {
  readonly card: Card | null;
  /** Whether this card is currently selected. */
  readonly selected?: boolean;
  /** Called when the card is tapped. Presence enables interactivity. */
  readonly onSelect?: (cardId: CardInstanceId) => void;
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
  transition: "transform 0.1s ease-out, box-shadow 0.1s ease-out",
};

const faceUpStyle: CSSProperties = {
  ...baseCardStyle,
  backgroundColor: "#fff",
  border: "1px solid #ddd",
};

const faceUpSelectedStyle: CSSProperties = {
  ...baseCardStyle,
  backgroundColor: "#fff",
  border: "2px solid var(--color-accent)",
  boxShadow: "0 0 8px var(--color-accent-dim)",
  transform: "translateY(-4px)",
};

const faceUpInteractiveStyle: CSSProperties = {
  cursor: "pointer",
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

export function CardMini({
  card,
  selected = false,
  onSelect,
}: CardMiniProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    if (!card || !onSelect) return;
    onSelect(card.id);
  }, [card, onSelect]);

  // Null card = hidden from this player by visibility rules.
  // Non-null card = player is allowed to see it (visibility already enforced
  // by createPlayerView). Show face-up regardless of card.faceUp property.
  if (!card) {
    return <div style={faceDownStyle} aria-label="Face-down card" />;
  }

  const isRed = RED_SUITS.has(card.suit);
  const textColor = isRed ? "var(--color-card-red)" : "#1a1a2e";
  const suitSymbol = SUIT_SYMBOLS[card.suit] ?? card.suit;

  const isInteractive = onSelect !== undefined;
  const cardStyle: CSSProperties = {
    ...(selected ? faceUpSelectedStyle : faceUpStyle),
    ...(isInteractive ? faceUpInteractiveStyle : {}),
  };

  return (
    <div
      style={cardStyle}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={`${card.rank} of ${card.suit}${selected ? " (selected)" : ""}`}
      aria-pressed={isInteractive ? selected : undefined}
      onClick={isInteractive ? handleClick : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      <span style={{ ...rankStyle, color: textColor }}>{card.rank}</span>
      <span style={{ color: textColor }}>{suitSymbol}</span>
    </div>
  );
}
