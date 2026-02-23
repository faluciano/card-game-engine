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
  const base = zoneName.replace(/:\d+$/, "");
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

  // Discover all personal zones for this player (hand, split_hand, etc.)
  const mySuffix = `:${myIndex}`;
  const myZones = Object.entries(zones)
    .filter(([name]) => name.endsWith(mySuffix))
    .filter(([, zone]) => zone.cardCount > 0);

  // Other zones with visible cards (community cards, discard pile, etc.)
  // Exclude zones where all cards are null (visibility-hidden zones)
  const otherZones = Object.entries(zones).filter(
    ([name, zone]) =>
      !name.endsWith(mySuffix) &&
      zone.cardCount > 0 &&
      zone.cards.some((card) => card !== null),
  );

  const hasAnyCards = myZones.length > 0 || otherZones.length > 0;

  if (!hasAnyCards) {
    return (
      <div style={containerStyle}>
        <p style={emptyStyle}>No cards dealt yet</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Player's personal zones — always shown first */}
      {myZones.map(([name, zone]) => (
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
