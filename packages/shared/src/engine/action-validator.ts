// ─── Action Validator ──────────────────────────────────────────────
// Determines which actions are valid for a given player in the
// current game state. Prevents illegal moves at the engine level.

import type {
  CardGameAction,
  CardGameState,
  PlayerId,
  PhaseDefinition,
} from "../types/index.js";

/**
 * A valid action descriptor: the action kind plus any constraints.
 */
export interface ValidAction {
  readonly kind: CardGameAction["kind"];
  readonly label: string;
  readonly enabled: boolean;
}

/**
 * Returns the list of valid actions for a player in the current state.
 * Uses the current phase's action definitions and evaluates their
 * conditions against the game state.
 */
export function getValidActions(
  state: CardGameState,
  playerId: PlayerId
): readonly ValidAction[] {
  if (state.status.kind !== "in_progress") {
    return [];
  }

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer) {
    return [];
  }

  // TODO: Look up current phase from state.currentPhase
  // TODO: Filter phase actions by player role
  // TODO: Evaluate each action's condition expression
  // TODO: Return ValidAction array with enabled/disabled status
  return [];
}

/**
 * Validates whether a specific action is legal in the current state.
 * Returns a discriminated result — not a boolean — so callers get
 * the rejection reason without a separate error channel.
 */
export function validateAction(
  state: CardGameState,
  action: CardGameAction
): ActionValidationResult {
  if (state.status.kind !== "in_progress") {
    return { valid: false, reason: "Game is not in progress" };
  }

  // TODO: Verify it's the acting player's turn (for turn_based phases)
  // TODO: Verify the action kind is allowed in the current phase
  // TODO: Verify action-specific constraints (e.g., card exists in zone)
  // TODO: Return { valid: true } or { valid: false, reason }
  return { valid: false, reason: "Not implemented: validateAction" };
}

/** Discriminated validation result — success or failure with reason. */
export type ActionValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };
