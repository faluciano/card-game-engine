// ─── Lobby Screen ──────────────────────────────────────────────────
// Shows the player's name and waits for the host to start the game.

import React from "react";
import type { CSSProperties } from "react";

interface LobbyScreenProps {
  readonly playerName: string;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
  gap: 16,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const nameStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
};

const waitingStyle: CSSProperties = {
  fontSize: 16,
  color: "var(--color-text-muted)",
  animation: "pulse 1.5s ease-in-out infinite",
};

export function LobbyScreen({
  playerName,
}: LobbyScreenProps): React.JSX.Element {
  return (
    <div style={containerStyle}>
      <p style={labelStyle}>You joined as</p>
      <p style={nameStyle}>{playerName}</p>
      <p style={waitingStyle}>Waiting for host to start the game...</p>
    </div>
  );
}
