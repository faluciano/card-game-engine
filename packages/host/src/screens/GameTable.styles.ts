// ─── Game Table Styles ─────────────────────────────────────────────
// RN StyleSheets for GameTable.tsx, kept separate so renderer diffs
// stay readable. Colour tokens come from host-core.

import { StyleSheet } from "react-native";
import { colors } from "@card-engine/host-core";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.feltDark,
  },
  errorText: {
    color: colors.danger,
    fontSize: 28,
    textAlign: "center",
    marginTop: 48,
  },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.tableBgEdge,
    borderBottomWidth: 1,
    borderBottomColor: colors.tableBorder,
    paddingHorizontal: 32,
    paddingVertical: 10,
    gap: 32,
  },
  phaseLabel: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: "700",
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 22,
  },
  turnIndicator: {
    color: colors.textBright,
    fontSize: 22,
    fontWeight: "600",
  },
  turnNumber: {
    color: colors.textMuted,
    fontSize: 20,
    marginLeft: "auto",
  },

  // Table layout
  tableLayout: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    paddingBottom: 20,
  },

  // Sections
  section: {
    flex: 1,
    width: "100%",
    maxWidth: 1280,
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 6,
  },

  // Zone layout
  zonesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 20,
  },
  zone: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 10,
    minWidth: 140,
  },
  zoneName: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyZone: {
    width: 52,
    height: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyZoneText: {
    color: colors.textFaint,
    fontSize: 12,
  },

  // Cards
  card: {
    width: 52,
    height: 74,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
  cardFace: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardFaceBorder,
  },
  cardBack: {
    backgroundColor: colors.dark,
    borderWidth: 1,
    borderColor: colors.goldDim,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 5,
  },
  cardBackFrame: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.goldDim,
    borderRadius: 4,
  },
  cardCorner: {
    position: "absolute",
    top: 4,
    left: 5,
    alignItems: "center",
  },
  cardRank: {
    color: colors.cardInk,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 18,
  },
  cardSuit: {
    color: colors.cardInk,
    fontSize: 13,
    lineHeight: 14,
  },
  cardPip: {
    color: colors.cardInk,
    fontSize: 22,
    opacity: 0.85,
  },

  // Stacked deck (collapsed face-down pile)
  stackedDeck: {
    width: 78,
    height: 92,
    position: "relative",
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
    backgroundColor: colors.gold,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  stackBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "800",
  },

  // Overflow indicator
  moreIndicator: {
    height: 72,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  moreIndicatorText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },

  // Top card only indicator (collapsed face-up zone)
  topCardMoreIndicator: {
    height: 72,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  topCardMoreText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },

  // Active suit indicator
  activeSuitContainer: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.gold,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  activeSuitLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4,
  },
  activeSuitSymbol: {
    fontSize: 36,
    lineHeight: 42,
  },
  activeSuitName: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
  },

  // Player sections
  playerSection: {
    width: "100%",
    marginBottom: 8,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  playerSectionActive: {
    backgroundColor: colors.tableSurface,
    borderColor: colors.goldDim,
  },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 6,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarActive: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  avatarText: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: "800",
  },
  avatarTextActive: {
    color: colors.black,
  },
  playerLabel: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "600",
  },
  playerLabelActive: {
    color: colors.textBright,
  },
  scoreChip: {
    backgroundColor: colors.tableSurfaceRaised,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    minWidth: 34,
    alignItems: "center",
  },
  scoreChipText: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: "800",
  },
  turnBadge: {
    backgroundColor: colors.gold,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  turnBadgeText: {
    color: colors.black,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },

  // Score board
  scoreBoard: {
    backgroundColor: colors.tableSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 12,
    minWidth: 420,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.tableBorder,
  },
  scoreName: {
    color: colors.text,
    fontSize: 22,
  },
  scoreValue: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: "700",
  },

  // Results overlay
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayCard: {
    backgroundColor: colors.tableSurface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.tableBorder,
    padding: 48,
    alignItems: "center",
    minWidth: 400,
  },
  overlayTitle: {
    color: colors.gold,
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 16,
  },
  overlayWinner: {
    color: colors.textBright,
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 36,
  },
  overlayButtons: {
    flexDirection: "row",
    gap: 20,
  },
  overlayButton: {
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderWidth: 3,
    borderColor: "transparent",
  },
  overlayButtonSecondary: {
    backgroundColor: colors.tableSurfaceRaised,
  },
  overlayButtonFocused: {
    borderColor: colors.gold,
  },
  overlayButtonTextSecondary: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
  },
});

export const resultsStyles = StyleSheet.create({
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 12,
  },
  playerName: {
    color: colors.text,
    fontSize: 28,
    flex: 1,
  },
  handValue: {
    color: colors.textMuted,
    fontSize: 24,
  },
  resultBadge: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  resultBadgeText: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "700",
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
    paddingTop: 12,
  },
  npcRow: {
    flexDirection: "row",
    alignItems: "center",
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
    textAlign: "center",
  },
});
