// ─── Action Bar Logic ──────────────────────────────────────────────
// How a tapped action button becomes a HostAction, and when the bar
// should hand over to the suit picker.

import type {
  CardInstanceId,
  HostAction,
  Player,
  PlayerId,
  ValidAction,
} from "@card-engine/shared";

/** Tracks which card the player has tapped in their hand. */
export interface SelectedCard {
  readonly cardId: CardInstanceId;
  readonly zoneName: string;
  /** The card's rank, for declares that take a `selected_card_rank` param. */
  readonly rank: string;
}

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

/** True when the action needs a card picked from the hand before it can be sent. */
function usesSelectedCard(action: ValidAction): boolean {
  if (action.actionName === "play_card") return true;
  return Object.values(action.params ?? {}).some((spec) => spec.kind === "selected_card_rank");
}

/** True when the action asks the player to pick another player. */
export function targetsOtherPlayer(action: ValidAction): boolean {
  return Object.values(action.params ?? {}).some((spec) => spec.kind === "other_player");
}

/** Returns true when any valid action needs a card selected in the hand. */
export function hasCardSelectionAction(actions: readonly ValidAction[]): boolean {
  return actions.some(usesSelectedCard);
}

/** True when an enabled action is waiting on a card selection. */
export function needsCardSelectionHint(
  actions: readonly ValidAction[],
  selectedCard: SelectedCard | null,
): boolean {
  return selectedCard === null && actions.some((a) => a.enabled && usesSelectedCard(a));
}

/** Players the current player can target with an `other_player` param, with their engine index. */
export function otherPlayerTargets(
  players: readonly Player[],
  myPlayerId: PlayerId,
): readonly { readonly index: number; readonly player: Player }[] {
  return players
    .map((player, index) => ({ index, player }))
    .filter(({ player }) => player.id !== myPlayerId);
}

/**
 * Builds the HostAction for a tapped button, or null while a required
 * choice is missing. `play_card` needs a selected card and the engine's
 * target zone; a declare fills its params from the selected card's rank
 * and the tapped target player.
 */
export function buildGameAction(
  action: ValidAction,
  playerId: PlayerId,
  selectedCard: SelectedCard | null,
  targetPlayerIndex: number | null = null,
): HostAction | null {
  if (action.actionName === "play_card") {
    if (selectedCard === null || action.targetZone === undefined) return null;
    return {
      type: "GAME_ACTION",
      action: {
        kind: "play_card",
        playerId,
        cardId: selectedCard.cardId,
        fromZone: selectedCard.zoneName,
        toZone: action.targetZone,
      },
    };
  }

  if (action.params === undefined) {
    return {
      type: "GAME_ACTION",
      action: { kind: "declare", playerId, declaration: action.actionName },
    };
  }

  const params: Record<string, string | number> = {};
  for (const [name, spec] of Object.entries(action.params)) {
    switch (spec.kind) {
      case "selected_card_rank":
        if (selectedCard === null) return null;
        params[name] = selectedCard.rank;
        break;
      case "other_player":
        if (targetPlayerIndex === null) return null;
        params[name] = targetPlayerIndex;
        break;
    }
  }
  return {
    type: "GAME_ACTION",
    action: { kind: "declare", playerId, declaration: action.actionName, params },
  };
}
