// ─── Playing Screen Logic ──────────────────────────────────────────
// Pure helpers for the gameplay screen: splitting shared piles out of
// the hand view, choosing the "new round" action, and the fingerprint
// that resets card selection when the available actions change.

import type { Card, FilteredZoneState, ValidAction } from "@card-engine/shared";

/** Zone names that get special compact rendering instead of full card lists. */
export const COMPACT_ZONE_NAMES: ReadonlySet<string> = new Set(["discard", "draw_pile", "deck"]);

export interface CompactZoneSplit {
  /** Every zone that is not a compact pile — what HandViewer renders. */
  readonly handZones: Readonly<Record<string, FilteredZoneState>>;
  readonly discardZone: FilteredZoneState | null;
  readonly deckZone: FilteredZoneState | null;
  /** "draw_pile" or "deck", whichever the ruleset uses. */
  readonly deckZoneName: string;
}

/** Separates the discard and deck piles from the zones HandViewer should draw. */
export function splitCompactZones(
  zones: Readonly<Record<string, FilteredZoneState>>,
): CompactZoneSplit {
  const handZones: Record<string, FilteredZoneState> = {};
  for (const [name, zone] of Object.entries(zones)) {
    if (!COMPACT_ZONE_NAMES.has(name)) handZones[name] = zone;
  }
  const deckZoneName = zones.draw_pile != null ? "draw_pile" : "deck";
  return {
    handZones,
    discardZone: zones.discard ?? null,
    deckZone: zones[deckZoneName] ?? null,
    deckZoneName,
  };
}

/** Visible (non-hidden) cards of a zone, preserving order. */
export function visibleCards(zone: FilteredZoneState | null): readonly Card[] {
  return zone?.cards.filter((c): c is Card => c !== null) ?? [];
}

/** Stable key for "the set of available actions"; selection resets when it changes. */
export function actionFingerprint(actions: readonly ValidAction[]): string {
  return actions
    .map((a) => a.actionName)
    .sort()
    .join(",");
}

/** Declaration names that read as "start the next round", most specific first. */
const NEW_ROUND_PATTERNS: readonly RegExp[] = [/round/i, /again/i, /continue|next|restart|redeal/i];

/**
 * Picks the declaration to send from the round-results banner. Prefers an
 * enabled action whose name reads as "new round" (`new_round`, `play_again`,
 * `next_round`), then any enabled declaration; `play_card` is never chosen.
 */
export function pickNewRoundAction(actions: readonly ValidAction[]): ValidAction | null {
  const candidates = actions.filter((a) => a.actionName !== "play_card" && a.enabled);
  for (const pattern of NEW_ROUND_PATTERNS) {
    const match = candidates.find((a) => pattern.test(a.actionName) || pattern.test(a.label));
    if (match) return match;
  }
  return candidates[0] ?? null;
}
