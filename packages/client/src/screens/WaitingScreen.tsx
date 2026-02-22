// ─── Waiting Screen ────────────────────────────────────────────────
// Generic waiting screen with a message and animated card suits.
// Used when the host is selecting a game or during loading states.

import React from "react";
import type { CSSProperties } from "react";

interface WaitingScreenProps {
  readonly message: string;
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

const suitStyle: CSSProperties = {
  fontSize: 48,
  animation: "pulse 2s ease-in-out infinite",
};

const messageStyle: CSSProperties = {
  fontSize: 18,
  color: "var(--color-text-muted)",
  animation: "pulse 1.5s ease-in-out infinite",
};

export function WaitingScreen({
  message,
}: WaitingScreenProps): React.JSX.Element {
  return (
    <div style={containerStyle}>
      <p style={suitStyle}>{"\u2660 \u2665 \u2663 \u2666"}</p>
      <p style={messageStyle}>{message}</p>
    </div>
  );
}
