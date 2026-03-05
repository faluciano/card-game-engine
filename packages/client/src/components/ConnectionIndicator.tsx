// ─── Connection Indicator ──────────────────────────────────────────
// Persistent connection health dot. Shows green when connected,
// yellow with pulse when reconnecting, red when disconnected.

import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface ConnectionIndicatorProps {
  readonly status: "connecting" | "connected" | "disconnected" | "error";
}

const containerStyle: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 20,
  backgroundColor: "rgba(0,0,0,0.6)",
  backdropFilter: "blur(4px)",
  fontSize: 11,
  fontWeight: 600,
  zIndex: 1000,
  transition: "opacity 0.5s",
  pointerEvents: "none",
};

const baseDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

const greenDotStyle: CSSProperties = {
  ...baseDotStyle,
  backgroundColor: "#28a745",
};

const yellowDotStyle: CSSProperties = {
  ...baseDotStyle,
  backgroundColor: "#ffc107",
  animation: "pulse 1.5s ease-in-out infinite",
};

const redDotStyle: CSSProperties = {
  ...baseDotStyle,
  backgroundColor: "#dc3545",
};

const labelStyle: CSSProperties = {
  color: "#eaeaea",
  whiteSpace: "nowrap",
};

const STATUS_CONFIG: Record<
  ConnectionIndicatorProps["status"],
  { readonly dotStyle: CSSProperties; readonly label: string | null }
> = {
  connected: { dotStyle: greenDotStyle, label: null },
  connecting: { dotStyle: yellowDotStyle, label: "Reconnecting…" },
  disconnected: { dotStyle: redDotStyle, label: "Disconnected" },
  error: { dotStyle: redDotStyle, label: "Connection error" },
};

export function ConnectionIndicator({
  status,
}: ConnectionIndicatorProps): React.JSX.Element {
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    if (status !== "connected") {
      setDimmed(false);
      return;
    }

    const timer = setTimeout(() => setDimmed(true), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const { dotStyle, label } = STATUS_CONFIG[status];

  return (
    <div style={{ ...containerStyle, opacity: dimmed ? 0.4 : 1 }}>
      <div style={dotStyle} />
      {label != null && <span style={labelStyle}>{label}</span>}
    </div>
  );
}
