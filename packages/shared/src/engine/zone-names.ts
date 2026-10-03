// ─── Zone Names ────────────────────────────────────────────────────
// Per-player zones are stored under "{base}:{playerIndex}" (e.g. "hand:2").
// Every place that builds or inspects such a name goes through here so the
// convention lives in exactly one spot.

/** Separator between a per-player zone's base name and the player index. */
const PER_PLAYER_SEPARATOR = ":";

/**
 * Builds the concrete zone name for `base` owned by the player at `index`.
 *
 * @example perPlayerZone("hand", 2) // "hand:2"
 */
export function perPlayerZone(base: string, index: number): string {
  return `${base}${PER_PLAYER_SEPARATOR}${index}`;
}
