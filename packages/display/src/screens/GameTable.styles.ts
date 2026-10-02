// ─── Game Table Styles (web) ───────────────────────────────────────
// CSSProperties maps for GameTable.tsx, kept separate so renderer diffs
// stay readable. Mirrors packages/host/src/screens/GameTable.styles.ts.

import type React from "react";
import { colors } from "@card-engine/host-core";

const CARD_SHADOW = "0 2px 3px rgba(0, 0, 0, 0.35)";

export const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.feltDark,
    position: "relative",
    minHeight: 0,
  },
  errorText: {
    color: colors.danger,
    fontSize: 28,
    textAlign: "center",
    marginTop: 48,
    width: "100%",
  },

  // Status bar
  statusBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.tableBgEdge,
    borderBottom: `1px solid ${colors.tableBorder}`,
    padding: "10px 32px",
    gap: 32,
    flexShrink: 0,
  },
  phaseLabel: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: 700,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 22,
  },
  turnIndicator: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: 600,
  },
  turnNumber: {
    color: colors.textMuted,
    fontSize: 20,
    marginLeft: "auto",
  },

  // Table layout
  tableLayout: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    minHeight: 0,
    overflowY: "auto",
  },

  // Sections
  section: {
    width: "100%",
    maxWidth: 1280,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 6,
  },

  // Zone layout
  zonesRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 20,
    width: "100%",
  },
  zone: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `1px solid ${colors.tableBorder}`,
    padding: 10,
    minWidth: 140,
    cursor: "pointer",
    outline: "none",
  },
  zoneName: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyZone: {
    display: "flex",
    width: 52,
    height: 74,
    borderRadius: 8,
    border: `1px dashed ${colors.tableBorder}`,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  emptyZoneText: {
    color: colors.textFaint,
    fontSize: 12,
  },

  // Cards
  card: {
    display: "flex",
    position: "relative",
    width: 52,
    height: 74,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: CARD_SHADOW,
    boxSizing: "border-box",
    flexShrink: 0,
  },
  cardFace: {
    backgroundColor: colors.white,
    border: `1px solid ${colors.cardFaceBorder}`,
  },
  cardBack: {
    backgroundColor: colors.dark,
    border: `1px solid ${colors.goldDim}`,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 5,
  },
  cardBackFrame: {
    flex: 1,
    border: `1px solid ${colors.goldDim}`,
    borderRadius: 4,
  },
  cardCorner: {
    position: "absolute",
    top: 4,
    left: 5,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  cardRank: {
    color: colors.cardInk,
    fontSize: 17,
    fontWeight: 800,
    lineHeight: "18px",
  },
  cardSuit: {
    color: colors.cardInk,
    fontSize: 13,
    lineHeight: "14px",
  },
  cardPip: {
    color: colors.cardInk,
    fontSize: 22,
    opacity: 0.85,
  },

  // Stacked deck (collapsed pile)
  stackedDeck: {
    position: "relative",
    width: 78,
    height: 92,
    flexShrink: 0,
  },
  stackShadow2: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0.4,
  },
  stackShadow1: {
    position: "absolute",
    top: 5,
    left: 5,
    opacity: 0.7,
  },
  stackTop: {
    position: "absolute",
    top: 10,
    left: 10,
  },
  stackBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    display: "flex",
    backgroundColor: colors.gold,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    boxSizing: "border-box",
  },
  stackBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: 800,
  },

  // Overflow indicator
  moreIndicator: {
    display: "flex",
    height: 72,
    alignItems: "center",
    padding: "0 8px",
  },
  moreIndicatorText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: 700,
  },

  // Active suit indicator
  activeSuitContainer: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `2px solid ${colors.gold}`,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  activeSuitLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeSuitSymbol: {
    fontSize: 36,
    lineHeight: "42px",
  },
  activeSuitName: {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 2,
  },

  // Player sections
  playerSection: {
    width: "100%",
    marginBottom: 8,
    padding: 8,
    borderRadius: 14,
    // Longhands, not the `border` shorthand: the active variant overrides only
    // `borderColor`, and React won't re-apply an unchanged shorthand when the
    // longhand is dropped — the old color would stick when the turn moves on.
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    boxSizing: "border-box",
  },
  playerSectionActive: {
    backgroundColor: colors.tableSurface,
    borderColor: colors.goldDim,
  },
  playerHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 6,
  },
  avatar: {
    display: "flex",
    width: 34,
    height: 34,
    borderRadius: "50%",
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.tableBorder,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  avatarActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  avatarText: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: 800,
  },
  avatarTextActive: {
    color: colors.black,
  },
  playerLabel: {
    color: colors.text,
    fontSize: 22,
    fontWeight: 600,
  },
  playerLabelActive: {
    color: colors.textBright,
  },
  scoreChip: {
    display: "flex",
    backgroundColor: colors.tableSurfaceRaised,
    border: `1px solid ${colors.tableBorder}`,
    borderRadius: 999,
    padding: "3px 12px",
    minWidth: 34,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  scoreChipText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: 800,
  },
  turnBadge: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    padding: "3px 12px",
  },
  turnBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1,
  },

  // Score board
  scoreBoard: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    border: `1px solid ${colors.tableBorder}`,
    padding: 12,
    minWidth: 420,
  },
  scoreRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: "5px 0",
    borderBottom: `1px solid ${colors.tableBorder}`,
  },
  scoreName: {
    color: colors.text,
    fontSize: 22,
  },
  scoreValue: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: 700,
  },

  // Results overlay
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    boxSizing: "border-box",
  },
  overlayCard: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.tableSurface,
    borderRadius: 24,
    border: `1px solid ${colors.tableBorder}`,
    padding: 48,
    alignItems: "center",
    minWidth: 400,
    maxHeight: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
  },
  overlayTitle: {
    color: colors.gold,
    fontSize: 48,
    fontWeight: 800,
    letterSpacing: 3,
    marginBottom: 16,
  },
  overlayWinner: {
    color: colors.textBright,
    fontSize: 32,
    fontWeight: 600,
    marginBottom: 36,
  },
  overlayButtons: {
    display: "flex",
    flexDirection: "row",
    gap: 20,
  },
  overlayButton: {
    borderRadius: 999,
    padding: "18px 40px",
    backgroundColor: colors.tableSurfaceRaised,
  },
  overlayButtonText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: 700,
  },
} satisfies Record<string, React.CSSProperties>;

export const resultsStyles = {
  playerRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 16,
    marginBottom: 12,
  },
  playerName: {
    color: colors.text,
    fontSize: 28,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  handValue: {
    color: colors.textMuted,
    fontSize: 24,
  },
  resultBadge: {
    borderRadius: 8,
    padding: "6px 16px",
  },
  resultBadgeText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: 700,
  },
  divider: {
    alignSelf: "stretch",
    borderTop: `1px solid ${colors.border}`,
    marginTop: 8,
    paddingTop: 12,
  },
  npcRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 16,
    marginBottom: 4,
  },
  npcLabel: {
    color: colors.neutral,
    fontSize: 24,
    flex: 1,
  },
  npcScore: {
    color: colors.textMuted,
    fontSize: 24,
  },
  waitingText: {
    color: colors.textDim,
    fontSize: 18,
    marginTop: 24,
    marginBottom: 24,
    textAlign: "center",
  },
} satisfies Record<string, React.CSSProperties>;
