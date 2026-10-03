// ─── Catalog Screen Styles ─────────────────────────────────────────
// Inline style constants for CatalogScreen and FilterControls.

import type { CSSProperties } from "react";

export const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  animation: "fadeIn 0.3s ease-out",
};

export const headerStyle: CSSProperties = {
  padding: "20px 16px 12px",
  fontSize: 24,
  fontWeight: 700,
  color: "var(--color-text)",
};

export const controlsStyle: CSSProperties = {
  padding: "0 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flexShrink: 0,
};

export const searchInputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid transparent",
  borderRadius: "var(--radius-md)",
  fontSize: 15,
  outline: "none",
};

export const chipRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  paddingBottom: 4,
  scrollbarWidth: "none",
};

const chipBaseStyle: CSSProperties = {
  flexShrink: 0,
  padding: "6px 14px",
  border: "none",
  borderRadius: "var(--radius-pill)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background-color 0.15s, color 0.15s",
};

/** Applied to a <fieldset>, so the browser's default border/padding are reset. */
export const playerFilterRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  border: "none",
  margin: 0,
  padding: 0,
  minWidth: 0,
};

export const playerLabelStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--color-text-muted)",
  fontWeight: 500,
  flexShrink: 0,
};

export const categoryRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  overflowX: "auto",
  paddingBottom: 4,
  scrollbarWidth: "none",
};

const categoryBaseStyle: CSSProperties = {
  flexShrink: 0,
  padding: "6px 12px",
  border: "none",
  borderRadius: "var(--radius-md)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  transition: "background-color 0.15s, color 0.15s",
};

export const sectionDividerStyle: CSSProperties = {
  height: 1,
  backgroundColor: "var(--color-surface-raised)",
  margin: "6px 0 2px",
  opacity: 0.5,
};

export const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

export const mutedTextStyle: CSSProperties = {
  fontSize: 15,
  color: "var(--color-text-muted)",
};

export const errorBannerStyle: CSSProperties = {
  margin: "0 16px 12px",
  padding: "10px 14px",
  borderRadius: "var(--radius-sm)",
  backgroundColor: "rgba(220, 53, 69, 0.15)",
  color: "var(--color-danger)",
  fontSize: 13,
  textAlign: "center",
};

export const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: "40px 16px",
  textAlign: "center",
};

export const clearFiltersButtonStyle: CSSProperties = {
  padding: "8px 20px",
  border: "none",
  borderRadius: "var(--radius-pill)",
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text)",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

export const filteredLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "2px 0",
};

export const staleBannerStyle: CSSProperties = {
  margin: "0 16px 8px",
  padding: "6px 14px",
  borderRadius: "var(--radius-sm)",
  backgroundColor: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  fontSize: 12,
  textAlign: "center",
};

// ─── Style helpers ─────────────────────────────────────────────────

const activeColors = (active: boolean): CSSProperties => ({
  backgroundColor: active ? "var(--color-accent)" : "var(--color-surface)",
  color: active ? "#fff" : "var(--color-text-muted)",
});

export function chipStyle(active: boolean): CSSProperties {
  return { ...chipBaseStyle, ...activeColors(active) };
}

export function categoryTabStyle(active: boolean): CSSProperties {
  return { ...categoryBaseStyle, ...activeColors(active) };
}

export function playerChipStyle(active: boolean): CSSProperties {
  return { ...chipBaseStyle, padding: "6px 12px", fontSize: 12, ...activeColors(active) };
}
