// ─── Selected Game ─────────────────────────────────────────────────
// The lobby's "currently selected" card, pinned above the catalog list.

import type React from "react";
import type { CSSProperties } from "react";
import type { CatalogGame } from "@card-engine/shared";
import { GameCard } from "./GameCard.js";

interface SelectedGameProps {
  readonly game: CatalogGame;
  readonly installedVersion: string | null;
  readonly isBuiltIn: boolean;
  readonly isPending: boolean;
  readonly onInstall: (game: CatalogGame) => void;
}

const containerStyle: CSSProperties = {
  padding: "0 16px 12px",
  flexShrink: 0,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 8,
};

export function SelectedGame({
  game,
  installedVersion,
  isBuiltIn,
  isPending,
  onInstall,
}: SelectedGameProps): React.JSX.Element {
  return (
    <div style={containerStyle}>
      <p style={labelStyle}>Selected Game</p>
      <GameCard
        game={game}
        installedVersion={installedVersion}
        isBuiltIn={isBuiltIn}
        isPending={isPending}
        isSelected
        onInstall={onInstall}
      />
    </div>
  );
}
