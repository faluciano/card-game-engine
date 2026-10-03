// ─── Compact Zones ─────────────────────────────────────────────────
// Shared piles rendered compactly: the discard pile shows its top card
// with a count badge (tap to expand), the deck shows a face-down card
// with a count badge.

import type React from "react";
import type { CSSProperties } from "react";
import type { Card, FilteredZoneState } from "@card-engine/shared";
import { formatZoneName } from "@card-engine/host-core/catalog";
import { CardMini } from "./CardMini.js";

interface CompactZonesProps {
  readonly discardZone: FilteredZoneState | null;
  /** Visible discard cards; index 0 is the most recently played. */
  readonly discardCards: readonly Card[];
  readonly deckZone: FilteredZoneState | null;
  readonly deckZoneName: string;
  readonly onOpenDiscard: () => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  justifyContent: "center",
  flexShrink: 0,
};

const zoneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const cardButtonStyle: CSSProperties = {
  position: "relative",
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "inherit",
};

const countBadgeStyle: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  minWidth: 20,
  height: 20,
  borderRadius: "var(--radius-md)",
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 11,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 4px",
};

const viewAllStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-accent)",
  cursor: "pointer",
  textDecoration: "underline",
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: "inherit",
};

// ─── Component ─────────────────────────────────────────────────────

export function CompactZones({
  discardZone,
  discardCards,
  deckZone,
  deckZoneName,
  onOpenDiscard,
}: CompactZonesProps): React.JSX.Element {
  const discardTopCard = discardCards[0] ?? null;

  return (
    <div style={rowStyle}>
      {discardZone != null && discardZone.cardCount > 0 && (
        <div style={zoneStyle}>
          <span style={labelStyle}>{formatZoneName("discard")}</span>
          <button
            type="button"
            style={cardButtonStyle}
            aria-label={`Discard pile, ${discardZone.cardCount} cards. Tap to view all.`}
            onClick={onOpenDiscard}
          >
            <CardMini card={discardTopCard} emphasized={discardTopCard != null} />
            <span style={countBadgeStyle}>{discardZone.cardCount}</span>
          </button>
          {discardCards.length > 1 && (
            <button type="button" style={viewAllStyle} onClick={onOpenDiscard}>
              View all
            </button>
          )}
        </div>
      )}

      {deckZone != null && deckZone.cardCount > 0 && (
        <div style={zoneStyle}>
          <span style={labelStyle}>{formatZoneName(deckZoneName)}</span>
          <div style={{ position: "relative" }}>
            <CardMini card={null} />
            <span style={countBadgeStyle}>{deckZone.cardCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
