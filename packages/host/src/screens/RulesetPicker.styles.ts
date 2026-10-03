// ─── Ruleset Picker Styles ─────────────────────────────────────────
// RN StyleSheet for RulesetPicker.tsx, kept separate so renderer diffs
// stay readable.

import { StyleSheet } from "react-native";
import { colors } from "@card-engine/host-core";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 48,
    paddingTop: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    color: colors.textBright,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: 2,
  },
  qrSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qrHint: {
    color: colors.textDim,
    fontSize: 18,
    lineHeight: 26,
  },
  listContent: {
    paddingBottom: 48,
  },
  grid: {
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
    borderColor: "transparent",
  },
  cardFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  cardBody: {
    alignSelf: "stretch",
  },
  cardName: {
    color: colors.textBright,
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 17,
    lineHeight: 23,
  },
  cardVersion: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 6,
  },
  badge: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
    letterSpacing: 1,
  },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  deleteButtonFocused: {
    borderColor: colors.danger,
  },
  deleteButtonConfirming: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  deleteLabelConfirming: {
    color: colors.textBright,
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
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
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: "transparent",
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
    fontWeight: "700",
    letterSpacing: 1,
  },
  tabLabelActive: {
    color: colors.textBright,
  },

  // Store
  storeMessage: {
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
  cardDesc: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 6,
  },
  getButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: "transparent",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  removeButton: {
    backgroundColor: "transparent",
    borderColor: colors.danger,
  },
  removeButtonFocused: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.danger,
  },
  removeLabel: {
    color: colors.danger,
  },
  getButtonDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  getButtonFocused: {
    borderColor: colors.textBright,
  },
  getLabel: {
    color: colors.textBright,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
  },
  getLabelDisabled: {
    color: colors.textMuted,
  },
  importButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 3,
    borderColor: "transparent",
    borderStyle: "dashed",
  },
  importButtonFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  importIcon: {
    color: colors.accent,
    fontSize: 36,
    fontWeight: "300",
    marginRight: 16,
  },
  importLabel: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: "500",
  },
});
