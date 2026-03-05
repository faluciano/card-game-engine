// ─── Active Suit Badge ─────────────────────────────────────────────
// Compact pill badge showing the currently active suit (e.g. Crazy Eights).
// Only renders when activeSuit is non-empty.

import React from "react";
import type { CSSProperties } from "react";

interface ActiveSuitBadgeProps {
  readonly activeSuit: string; // "Hearts" | "Diamonds" | "Clubs" | "Spades" | ""
}

const SUIT_DISPLAY: Readonly<
  Record<string, { readonly symbol: string; readonly red: boolean }>
> = {
  Hearts: { symbol: "\u2665", red: true },
  Diamonds: { symbol: "\u2666", red: true },
  Clubs: { symbol: "\u2663", red: false },
  Spades: { symbol: "\u2660", red: false },
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  borderRadius: 20,
  backgroundColor: "var(--color-surface-raised)",
  fontSize: 12,
  fontWeight: 700,
  animation: "fadeIn 0.3s ease-out",
  whiteSpace: "nowrap",
};

const symbolStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
};

export function ActiveSuitBadge({
  activeSuit,
}: ActiveSuitBadgeProps): React.JSX.Element | null {
  if (!activeSuit) return null;

  const display = SUIT_DISPLAY[activeSuit];
  if (!display) return null;

  const color = display.red
    ? "var(--color-card-red)"
    : "var(--color-card-black)";

  return (
    <div style={badgeStyle} aria-label={`Active suit: ${activeSuit}`}>
      <span style={{ ...symbolStyle, color }}>{display.symbol}</span>
      <span style={{ color }}>{activeSuit}</span>
    </div>
  );
}
