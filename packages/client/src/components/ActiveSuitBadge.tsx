// ─── Active Suit Badge ─────────────────────────────────────────────
// Compact pill badge showing the currently active suit (e.g. Crazy Eights).
// Only renders when activeSuit is non-empty.

import type React from "react";
import type { CSSProperties } from "react";
import { SUIT_SYMBOLS, formatSuitName, isRedSuit } from "@card-engine/host-core/catalog";

interface ActiveSuitBadgeProps {
  readonly activeSuit: string; // "Hearts" | "Diamonds" | "Clubs" | "Spades" | ""
}

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  borderRadius: "var(--radius-pill)",
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

export function ActiveSuitBadge({ activeSuit }: ActiveSuitBadgeProps): React.JSX.Element | null {
  if (!activeSuit) return null;

  const symbol = SUIT_SYMBOLS[activeSuit];
  if (!symbol) return null;

  const color = isRedSuit(activeSuit) ? "var(--color-card-red)" : "var(--color-card-black)";
  const label = formatSuitName(activeSuit);

  return (
    <div role="img" style={badgeStyle} aria-label={`Active suit: ${label}`}>
      <span style={{ ...symbolStyle, color }}>{symbol}</span>
      <span style={{ color }}>{label}</span>
    </div>
  );
}
