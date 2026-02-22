// ─── Hand Viewer ───────────────────────────────────────────────────
// Renders the player's hand zones and other visible zones.
// Groups cards by zone, showing the player's own hand first.

import React from "react";
import type { CSSProperties } from "react";
import type { PlayerView } from "@card-engine/shared";
import { CardMini } from "./CardMini.js";

interface HandViewerProps {
  readonly playerView: PlayerView;
}

const containerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  overflow: "auto",
};

const zoneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const zoneLabelStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const cardsRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  justifyContent: "center",
};

const emptyStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--color-text-muted)",
  textAlign: "center",
  padding: 16,
};

/**
 * Formats a zone name for display.
 * "hand_0" -> "Hand", "discard_pile" -> "Discard Pile", "community" -> "Community"
 */
function formatZoneName(zoneName: string): string {
  const base = zoneName.replace(/_\d+$/, "");
  return base
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function HandViewer({
  playerView,
}: HandViewerProps): React.JSX.Element {
  const { zones, myPlayerId, players } = playerView;

  // Find this player's index for identifying their personal zones
  const myIndex = players.findIndex((p) => p.id === myPlayerId);

  // Separate zones into personal hand and other visible zones
  const handZoneName = `hand_${myIndex}`;
  const handZone = zones[handZoneName];

  // Other zones with cards (community cards, discard pile, etc.)
  // Exclude draw piles — those are typically hidden
  const otherZones = Object.entries(zones).filter(
    ([name, zone]) =>
      name !== handZoneName &&
      !name.startsWith("draw_") &&
      zone.cardCount > 0,
  );

  const hasAnyCards = (handZone?.cardCount ?? 0) > 0 || otherZones.length > 0;

  if (!hasAnyCards) {
    return (
      <div style={containerStyle}>
        <p style={emptyStyle}>No cards dealt yet</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Player's hand — always shown first */}
      {handZone && handZone.cardCount > 0 && (
        <div style={zoneStyle}>
          <p style={zoneLabelStyle}>Your Hand</p>
          <div style={cardsRowStyle}>
            {handZone.cards.map((card, index) => (
              <CardMini
                key={card?.id ?? `hidden-${index}`}
                card={card}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other visible zones */}
      {otherZones.map(([name, zone]) => (
        <div key={name} style={zoneStyle}>
          <p style={zoneLabelStyle}>{formatZoneName(name)}</p>
          <div style={cardsRowStyle}>
            {zone.cards.map((card, index) => (
              <CardMini
                key={card?.id ?? `hidden-${name}-${index}`}
                card={card}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
