// ─── Discard Pile Modal ────────────────────────────────────────────
// Full list of visible discard cards, most recent first. Closes on
// backdrop tap, the Close button, or Escape.

import type React from "react";
import type { CSSProperties } from "react";
import type { Card } from "@card-engine/shared";
import { useEffect, useRef } from "react";
import { CardMini } from "./CardMini.js";

interface DiscardPileModalProps {
  /** Index 0 is the most recently played card. */
  readonly cards: readonly Card[];
  readonly onClose: () => void;
}

// ─── Styles ────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  animation: "fadeIn 0.15s ease-out",
};

const contentStyle: CSSProperties = {
  backgroundColor: "var(--color-surface)",
  borderRadius: "var(--radius-lg)",
  padding: 16,
  maxWidth: "90vw",
  maxHeight: "70vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const closeStyle: CSSProperties = {
  background: "none",
  border: "1px solid var(--color-text-muted)",
  borderRadius: "var(--radius-xs)",
  color: "var(--color-text)",
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const gridStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
  justifyContent: "center",
};

// ─── Component ─────────────────────────────────────────────────────

export function DiscardPileModal({ cards, onClose }: DiscardPileModalProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog so Escape reaches the handler, and hand it
  // back to whatever opened the dialog when it unmounts.
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-label="Discard pile"
      aria-modal="true"
      onClick={(e) => {
        // Close on backdrop click (not on content click)
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div style={contentStyle}>
        <div style={headerStyle}>
          <span style={titleStyle}>Discard Pile ({cards.length})</span>
          <button ref={closeRef} type="button" style={closeStyle} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={gridStyle}>
          {cards.map((card, index) => (
            <CardMini key={card.id} card={card} emphasized={index === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}
