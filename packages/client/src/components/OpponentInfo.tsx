// ─── Opponent Info ─────────────────────────────────────────────────
// Compact row showing opponent names and card counts.
// Uses zone data from PlayerView (cardCount is available for all zones).

import React from "react";
import type { CSSProperties } from "react";
import type { PlayerView } from "@card-engine/shared";

interface OpponentInfoProps {
  readonly playerView: PlayerView;
}

const rowStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  borderRadius: 20,
  backgroundColor: "var(--color-surface)",
  fontSize: 12,
  animation: "fadeIn 0.3s ease-out",
};

const nameStyle: CSSProperties = {
  color: "var(--color-text-muted)",
  maxWidth: 80,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const countBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 20,
  height: 20,
  padding: "0 5px",
  borderRadius: 10,
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text)",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
};

export function OpponentInfo({
  playerView,
}: OpponentInfoProps): React.JSX.Element | null {
  const { myPlayerId, players, zones } = playerView;

  const opponents = players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.id !== myPlayerId);

  if (opponents.length === 0) return null;

  return (
    <div style={rowStyle}>
      {opponents.map(({ player, index }) => {
        const handZone = zones[`hand:${index}`];
        const cardCount = handZone?.cardCount ?? 0;

        return (
          <div
            key={player.id}
            style={pillStyle}
            aria-label={`${player.name}: ${cardCount} cards`}
          >
            <span style={nameStyle}>{player.name}</span>
            <span style={countBadgeStyle}>{cardCount}</span>
          </div>
        );
      })}
    </div>
  );
}
