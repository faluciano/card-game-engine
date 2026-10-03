// ─── Ruleset Picker Styles (web) ───────────────────────────────────
// CSSProperties maps for RulesetPicker.tsx, kept separate so renderer
// diffs stay readable. Mirrors packages/host/src/screens/RulesetPicker.styles.ts.

import type React from "react";
import { colors } from "@card-engine/host-core";

export const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.bg,
    padding: "28px 48px 0",
    minHeight: 0,
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    margin: 0,
    color: colors.textBright,
    fontSize: 38,
    fontWeight: 800,
    letterSpacing: 2,
  },
  qrSection: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qrHint: {
    color: colors.textDim,
    fontSize: 18,
    lineHeight: 1.45,
  },
  tabPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  listContent: {
    flex: 1,
    overflowY: "auto",
    paddingBottom: 48,
    minHeight: 0,
  },
  grid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 16,
  },
  card: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 3,
    borderStyle: "solid",
    borderColor: "transparent",
    boxSizing: "border-box",
    minWidth: 0,
  },
  cardFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  cardBody: {
    // Button reset: the shell (styles.card) owns the visuals.
    display: "block",
    width: "100%",
    padding: 0,
    margin: 0,
    background: "none",
    border: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: 10,
  },
  cardName: {
    color: colors.textBright,
    fontSize: 26,
    fontWeight: 700,
    marginBottom: 4,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 17,
    lineHeight: 1.35,
  },
  cardVersion: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 6,
  },
  cardDesc: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 1.35,
    marginTop: 6,
  },
  badge: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: 700,
    marginTop: 12,
    letterSpacing: 1,
  },
  deleteButton: {
    marginTop: 12,
    padding: "6px 12px",
    borderRadius: 8,
    borderWidth: 2,
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 1,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 28,
    textAlign: "center",
    marginTop: 64,
  },

  // Tab bar
  tabBar: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  tab: {
    padding: "10px 26px",
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    cursor: "pointer",
    font: "inherit",
  },
  tabActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabFocused: {
    borderColor: colors.accent,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 1,
  },
  tabLabelActive: {
    color: colors.textBright,
  },

  // Store
  storeMessage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginTop: 48,
    gap: 16,
  },
  storeError: {
    color: colors.danger,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 16,
  },
  actionsRow: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  pillButton: {
    padding: "8px 26px",
    borderRadius: 999,
  },
  pillLabel: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: 1,
  },
  importButton: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 3,
    borderStyle: "dashed",
    borderColor: "transparent",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  importButtonFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  importIcon: {
    color: colors.accent,
    fontSize: 36,
    fontWeight: 300,
    marginRight: 16,
  },
  importLabel: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: 500,
  },
} satisfies Record<string, React.CSSProperties>;
