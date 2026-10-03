// ─── Game Card ─────────────────────────────────────────────────────
// Individual catalog entry rendered as an app-store style card.
// Shows game metadata and the install / update / select action. Which
// buttons appear is decided by `getGameCardModel` (built on host-core's
// `getStoreActions`), so built-in games never offer "Remove".

import type React from "react";
import type { CSSProperties } from "react";
import type { CatalogGame } from "@card-engine/shared";
import { formatPlayerRange } from "@card-engine/host-core/catalog";
import { getGameCardModel, type GameCardPrimary } from "../lib/game-card.js";

interface GameCardProps {
  readonly game: CatalogGame;
  /** Version installed on the host, or null when not installed. */
  readonly installedVersion: string | null;
  readonly isBuiltIn: boolean;
  /** Install in flight (host-side or a local download). */
  readonly isPending: boolean;
  readonly isUninstalling?: boolean;
  readonly onInstall: (game: CatalogGame) => void;
  readonly onUninstall?: () => void;
  /** Lobby only: choose this game. Presence enables the Select button. */
  readonly onSelect?: () => void;
  readonly isSelected?: boolean;
}

// ─── Styles ────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: 16,
  backgroundColor: "var(--color-surface)",
  borderRadius: "var(--radius-lg)",
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
  borderRadius: "var(--radius-pill)",
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const tagStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  padding: "2px 6px",
  borderRadius: "var(--radius-pill)",
  backgroundColor: "var(--color-accent-dim)",
  color: "var(--color-text)",
  whiteSpace: "nowrap",
};

const baseButtonStyle: CSSProperties = {
  flexShrink: 0,
  padding: "8px 18px",
  border: "none",
  borderRadius: "var(--radius-pill)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s",
  whiteSpace: "nowrap",
};

const accentButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: "var(--color-accent)",
  color: "#fff",
};

const doneButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: "var(--color-success)",
  color: "#fff",
  cursor: "default",
  opacity: 0.8,
};

const busyButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  cursor: "wait",
  opacity: 0.7,
};

const removeButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--color-text-muted)",
  cursor: "pointer",
  opacity: 0.7,
  transition: "opacity 0.15s",
};

const actionColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
};

// ─── Primary button ────────────────────────────────────────────────

function primaryButtonStyle(kind: GameCardPrimary["kind"]): CSSProperties {
  switch (kind) {
    case "get":
    case "update":
    case "select":
      return accentButtonStyle;
    case "selected":
    case "installed":
      return doneButtonStyle;
    case "installing":
    case "removing":
      return busyButtonStyle;
  }
}

// ─── Component ─────────────────────────────────────────────────────

export function GameCard({
  game,
  installedVersion,
  isBuiltIn,
  isPending,
  isUninstalling = false,
  onInstall,
  onUninstall,
  onSelect,
  isSelected = false,
}: GameCardProps): React.JSX.Element {
  const { primary, showRemove } = getGameCardModel({
    game,
    installedVersion,
    isBuiltIn,
    isPending,
    isUninstalling,
    isSelected,
    canSelect: onSelect !== undefined,
    canUninstall: onUninstall !== undefined,
  });

  const onPrimary =
    primary.kind === "get" || primary.kind === "update"
      ? () => onInstall(game)
      : primary.kind === "select"
        ? onSelect
        : undefined;

  return (
    <div style={cardStyle}>
      <div style={infoStyle}>
        <span style={nameStyle}>{game.name}</span>
        <span style={descriptionStyle}>{game.description ?? "No description"}</span>
        <div style={metaRowStyle}>
          <span style={badgeStyle}>{formatPlayerRange(game.players)}</span>
          {(game.tags ?? []).map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div style={actionColumnStyle}>
        <button
          type="button"
          style={primaryButtonStyle(primary.kind)}
          disabled={onPrimary === undefined}
          aria-busy={primary.kind === "installing" || primary.kind === "removing"}
          onClick={onPrimary}
        >
          {primary.label}
        </button>
        {showRemove && onUninstall && (
          <button
            type="button"
            style={removeButtonStyle}
            aria-label={`Remove ${game.name}`}
            onClick={onUninstall}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
