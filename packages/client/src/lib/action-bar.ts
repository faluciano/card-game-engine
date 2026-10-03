// ─── Action Bar Logic ──────────────────────────────────────────────
// How a tapped action button becomes a HostAction, and when the bar
// should hand over to the suit picker.

import type { CardInstanceId, HostAction, PlayerId, ValidAction } from "@card-engine/shared";

/** Tracks which card the player has tapped for a play_card action. */
export interface SelectedCard {
  readonly cardId: CardInstanceId;
  readonly zoneName: string;
}

/** Default target zone when a play_card action doesn't specify one. */
export const DEFAULT_PLAY_TARGET_ZONE = "discard";

export const SUIT_ACTION_NAMES: ReadonlySet<string> = new Set([
  "choose_hearts",
  "choose_diamonds",
  "choose_clubs",
  "choose_spades",
]);

/** Returns true when every action is a suit-choice declaration. */
export function isSuitPickerPhase(actions: readonly ValidAction[]): boolean {
  return actions.length > 0 && actions.every((a) => SUIT_ACTION_NAMES.has(a.actionName));
}

/** Returns true when any valid action requires card selection. */
export function hasPlayCardAction(actions: readonly ValidAction[]): boolean {
  return actions.some((a) => a.actionName === "play_card");
}

/** True when an enabled play_card action is waiting on a card selection. */
export function needsCardSelectionHint(
  actions: readonly ValidAction[],
  selectedCard: SelectedCard | null,
): boolean {
  return selectedCard === null && actions.some((a) => a.actionName === "play_card" && a.enabled);
}

/**
 * Builds the HostAction for a tapped button. `play_card` needs a selected
 * card and yields null without one; every other action is a declaration.
 */
export function buildGameAction(
  actionName: string,
  playerId: PlayerId,
  selectedCard: SelectedCard | null,
): HostAction | null {
  if (actionName === "play_card") {
    if (selectedCard === null) return null;
    return {
      type: "GAME_ACTION",
      action: {
        kind: "play_card",
        playerId,
        cardId: selectedCard.cardId,
        fromZone: selectedCard.zoneName,
        toZone: DEFAULT_PLAY_TARGET_ZONE,
      },
    };
  }
  return {
    type: "GAME_ACTION",
    action: { kind: "declare", playerId, declaration: actionName },
  };
}
