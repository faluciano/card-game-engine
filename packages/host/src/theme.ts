// ─── Theme ─────────────────────────────────────────────────────────
// Shared color tokens for the Android TV host UI. Centralizes the palette
// that was previously hardcoded across screens so colors stay consistent.

export const colors = {
  // Backgrounds / surfaces
  bg: "#121212",
  surface: "#1e1e1e",
  surfaceRaised: "#2a2a2a",
  border: "#333333",

  // Text
  textBright: "#ffffff",
  text: "#e0e0e0",
  textMuted: "#b0b0b0",
  textDim: "#888888",
  textFaint: "#666666",
  disabled: "#555555",

  // Brand / status
  accent: "#7c4dff",
  danger: "#ff5252",
  warning: "#ffd54f",
  success: "#4caf50",

  // Green felt (game table)
  feltDark: "#0d3320",
  felt: "#1a4d2e",
  feltLight: "#2e7d46",
  greenBright: "#66bb6a",
  greenLight: "#81c784",
  greenSoft: "#a5d6a7",
  greenPale: "#c8e6c9",

  // Card faces / suits
  cardFaceBorder: "#cccccc",
  cardBack: "#1565c0",
  cardBackBorder: "#0d47a1",
  cardInk: "#1a1a1a",
  suitRed: "#d32f2f",
  suitRedBright: "#ef5350",
  redAlt: "#f44336",
  amber: "#ffc107",
  wood: "#5c3d2e",
  dark: "#1a1a2e",
  neutralLight: "#cccccc",
  neutral: "#a0a0a0",

  white: "#ffffff",
  black: "#000000",
} as const;

export type Colors = typeof colors;
