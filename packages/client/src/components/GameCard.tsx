// ─── Game Card ─────────────────────────────────────────────────────
// Individual catalog entry rendered as an app-store style card.
// Shows game metadata and an install/installed action button.

import React from "react";
import type { CSSProperties } from "react";
import type { CatalogGame } from "@card-engine/shared";

interface GameCardProps {
  readonly game: CatalogGame;
  readonly isInstalled: boolean;
  readonly isPending: boolean;
  readonly onInstall: (game: CatalogGame) => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: 16,
  backgroundColor: "var(--color-surface)",
  borderRadius: 12,
  animation: "slideUp 0.3s ease-out both",
};

const infoStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const nameStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  color: "var(--color-text)",
  lineHeight: 1.2,
};

const descriptionStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
  marginTop: 2,
};

const badgeStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  padding: "2px 8px",
  borderRadius: 999,
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const tagStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  padding: "2px 6px",
  borderRadius: 999,
  backgroundColor: "var(--color-accent-dim)",
  color: "var(--color-text)",
  whiteSpace: "nowrap",
};

const baseButtonStyle: CSSProperties = {
  flexShrink: 0,
  padding: "8px 18px",
  border: "none",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s",
  whiteSpace: "nowrap",
};

// ─── Component ─────────────────────────────────────────────────────

function formatPlayerRange(min: number, max: number): string {
  if (min === max) return `${min} player${min === 1 ? "" : "s"}`;
  return `${min}\u2013${max} players`;
}

export function GameCard({
  game,
  isInstalled,
  isPending,
  onInstall,
}: GameCardProps): React.JSX.Element {
  const buttonStyle: CSSProperties = isInstalled
    ? {
        ...baseButtonStyle,
        backgroundColor: "var(--color-success)",
        color: "#fff",
        cursor: "default",
        opacity: 0.8,
      }
    : isPending
      ? {
          ...baseButtonStyle,
          backgroundColor: "var(--color-surface-raised)",
          color: "var(--color-text-muted)",
          cursor: "wait",
          opacity: 0.7,
        }
      : {
          ...baseButtonStyle,
          backgroundColor: "var(--color-accent)",
          color: "#fff",
        };

  const buttonLabel = isInstalled
    ? "Installed \u2713"
    : isPending
      ? "Installing\u2026"
      : "Get";

  return (
    <div style={cardStyle}>
      <div style={infoStyle}>
        <span style={nameStyle}>{game.name}</span>
        <span style={descriptionStyle}>{game.description}</span>
        <div style={metaRowStyle}>
          <span style={badgeStyle}>
            {formatPlayerRange(game.players.min, game.players.max)}
          </span>
          {game.tags.map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        style={buttonStyle}
        disabled={isInstalled || isPending}
        onClick={() => onInstall(game)}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
