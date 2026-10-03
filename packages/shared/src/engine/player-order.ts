// ─── Player Order ──────────────────────────────────────────────────
// Turn-order arithmetic shared by the interpreter's handlers and effects.

/**
 * Index of the player `steps` seats away from `current` in the given
 * direction, wrapping around the table. Always returns a value in
 * `[0, playerCount)` for a positive `playerCount`.
 */
export function nextPlayerIndex(
  current: number,
  direction: 1 | -1,
  playerCount: number,
  steps = 1,
): number {
  return (((current + direction * steps) % playerCount) + playerCount) % playerCount;
}
