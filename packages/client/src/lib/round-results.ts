// ─── Round Results ─────────────────────────────────────────────────
// Maps the engine's numeric round result to the banner's presentation.

export interface ResultConfig {
  readonly emoji: string;
  readonly label: string;
  readonly color: string;
}

export function getResultConfig(result: number): ResultConfig {
  if (result > 0) return { emoji: "🎉", label: "You Win!", color: "#4caf50" };
  if (result < 0) return { emoji: "💔", label: "You Lose", color: "#f44336" };
  return { emoji: "🤝", label: "Draw", color: "#ffc107" };
}

export function formatScore(label: string, score: number): string {
  return `${label}: ${score}`;
}
