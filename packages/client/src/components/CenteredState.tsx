// ─── Centered State ────────────────────────────────────────────────
// Shared full-area centered display for loading / empty / error states.
// Optional spinner and a single action button.

import React from "react";
import type { CSSProperties } from "react";

interface CenteredStateProps {
  readonly message: string;
  readonly spinner?: boolean;
  readonly tone?: "muted" | "danger";
  readonly action?: { readonly label: string; readonly onClick: () => void };
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

const spinnerStyle: CSSProperties = {
  fontSize: 32,
  animation: "spin 1s linear infinite",
};

const messageStyle: CSSProperties = {
  fontSize: 15,
};

const buttonStyle: CSSProperties = {
  padding: "10px 24px",
  border: "none",
  borderRadius: "var(--radius-pill)",
  backgroundColor: "var(--color-accent)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

export function CenteredState({
  message,
  spinner = false,
  tone = "muted",
  action,
}: CenteredStateProps): React.JSX.Element {
  const color =
    tone === "danger" ? "var(--color-danger)" : "var(--color-text-muted)";

  return (
    <div style={containerStyle}>
      {spinner && <span style={spinnerStyle}>{"\u2660"}</span>}
      <p style={{ ...messageStyle, color }}>{message}</p>
      {action && (
        <button type="button" style={buttonStyle} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
