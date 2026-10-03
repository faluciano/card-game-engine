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

/**
 * Returns the player index that owns a per-player zone name, or null for a
 * shared zone (one without a numeric "{base}:{index}" suffix).
 *
 * @example zoneOwnerIndex("hand:2") // 2
 * @example zoneOwnerIndex("discard") // null
 */
export function zoneOwnerIndex(zoneName: string): number | null {
  const separatorIndex = zoneName.lastIndexOf(PER_PLAYER_SEPARATOR);
  if (separatorIndex === -1) return null;
  const suffix = zoneName.slice(separatorIndex + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number(suffix);
}
