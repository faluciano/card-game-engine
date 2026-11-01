// ─── Host Action Guard ─────────────────────────────────────────────
// Decides which actions a phone may send to the host. CouchKit stamps
// every client action with the sender's `playerId`; host dispatches
// (the TV's own UI and orchestrator) carry none. A phone may only play
// its own cards and manage the game library — everything that paces or
// restarts the game is the host's.
//
// Pass it as CouchKit's `authorizeAction` runtime option: the runtime
// calls it for player actions only (never the host's own dispatches),
// fails closed if it throws, and sends the rejection reason to the phone.

import type { CardGameAction, PlayerId } from "../types/index";
import type { HostAction, HostGameState } from "./host-state";

/**
 * Engine actions a phone may send through GAME_ACTION: playing a card and
 * declaring one of the phase's named actions — both checked against the
 * ruleset. Everything else is host-only: phase pacing (`advance_phase`,
 * `step_phase`, `reset_round`) is driven by the host orchestrator; the
 * roster/lifecycle actions (`join`, `leave`, `start_game`) are owned by
 * CouchKit and START_GAME; and raw `draw_card` / `end_turn` would let a
 * phone draw from any zone or skip its turn outside the ruleset's actions.
 */
export const CLIENT_ACTION_KINDS: ReadonlySet<CardGameAction["kind"]> = new Set([
  "play_card",
  "declare",
]);

/** Host action types a phone may send. */
const CLIENT_HOST_ACTION_TYPES: ReadonlySet<HostAction["type"]> = new Set([
  "GAME_ACTION",
  "INSTALL_RULESET",
  "UNINSTALL_RULESET",
  "SELECT_RULESET",
]);

/** Why a phone's action was refused. */
export interface HostActionRejection {
  readonly reject: string;
}

/** The guard's verdict: the action to reduce (possibly rewritten), or a rejection. */
export type HostActionAuthorization = HostAction | HostActionRejection;

/**
 * Authorizes an incoming action before the host reduces it.
 *
 * - No sender: a host dispatch, passed through unchanged.
 * - From a phone: only GAME_ACTION and the library actions are allowed.
 *   A GAME_ACTION must carry a player move (`play_card` / `declare`), and
 *   its inner `playerId` is replaced with the sender's, so a phone can
 *   only ever act as its own player.
 *
 * @param action - The action as received.
 * @param senderId - The player CouchKit stamped on the action, if any.
 * @param _state - Current host state (unused today; part of the hook signature).
 */
export function authorizeHostAction(
  action: HostAction,
  senderId: string | undefined,
  _state: HostGameState,
): HostActionAuthorization {
  if (senderId === undefined) return action;

  if (!CLIENT_HOST_ACTION_TYPES.has(action.type)) {
    return { reject: `Players cannot send ${action.type}; only the host can` };
  }

  if (action.type !== "GAME_ACTION") return action;

  const inner = action.action;
  if (!CLIENT_ACTION_KINDS.has(inner.kind)) {
    return { reject: `Players cannot send the engine action ${inner.kind}` };
  }
  if (!("playerId" in inner)) return action;

  return { ...action, action: { ...inner, playerId: senderId as PlayerId } };
}

/** Narrows a guard verdict to a rejection. */
export function isHostActionRejection(
  result: HostActionAuthorization,
): result is HostActionRejection {
  return "reject" in result;
}
