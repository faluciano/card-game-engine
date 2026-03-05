// ─── Toast ──────────────────────────────────────────────────────────
// Ephemeral notification overlay. Auto-dismisses after a configurable
// duration. Used for action rejection feedback.

import React, { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface ToastProps {
  /** Message to display. When null/undefined, toast is hidden. */
  readonly message: string | null | undefined;
  /** Unique key to re-trigger the toast (e.g., a timestamp). */
  readonly triggerKey: number;
  /** Auto-dismiss duration in ms. Defaults to 2500. */
  readonly duration?: number;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  bottom: 80,
  left: 16,
  right: 16,
  display: "flex",
  justifyContent: "center",
  pointerEvents: "none",
  zIndex: 1000,
};

const toastStyle: CSSProperties = {
  backgroundColor: "var(--color-danger)",
  color: "#fff",
  padding: "10px 20px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  textAlign: "center",
  maxWidth: 320,
  animation: "slideUp 0.2s ease-out",
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
};

export function Toast({
  message,
  triggerKey,
  duration = 2500,
}: ToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message || triggerKey === 0) return;

    setDisplayMessage(message);
    setVisible(true);

    // Haptic feedback
    navigator.vibrate?.(200);

    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [triggerKey, message, duration]);

  if (!visible || !displayMessage) return null;

  return (
    <div style={overlayStyle}>
      <div style={toastStyle}>{displayMessage}</div>
    </div>
  );
}
