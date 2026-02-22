// ─── Connecting Screen ─────────────────────────────────────────────
// Shows spinner and connection status while connecting to the TV host.

import React from "react";
import type { CSSProperties } from "react";

interface ConnectingScreenProps {
  readonly status: "connecting" | "connected" | "disconnected" | "error";
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  padding: 24,
  textAlign: "center",
};

const spinnerStyle: CSSProperties = {
  width: 48,
  height: 48,
  border: "4px solid var(--color-surface-raised)",
  borderTopColor: "var(--color-accent)",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
  marginBottom: 24,
};

const titleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  marginBottom: 8,
};

const subtitleStyle: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: 14,
  animation: "pulse 1.5s ease-in-out infinite",
};

const STATUS_TEXT: Record<ConnectingScreenProps["status"], string> = {
  connecting: "Connecting to TV...",
  connected: "Connected",
  disconnected: "Connection lost",
  error: "Connection error",
};

export function ConnectingScreen({
  status,
}: ConnectingScreenProps): React.JSX.Element {
  const isRetrying = status === "disconnected" || status === "error";

  return (
    <div style={containerStyle}>
      <div style={spinnerStyle} />
      <p style={titleStyle}>{STATUS_TEXT[status]}</p>
      {isRetrying && <p style={subtitleStyle}>Reconnecting...</p>}
    </div>
  );
}
