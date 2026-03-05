// ─── Action Validator ──────────────────────────────────────────────
// Determines which actions are valid for a given player in the
// current game state. Prevents illegal moves at the engine level.

import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
  PlayerId,
  PhaseAction,
} from "../types/index";
import {
  evaluateCondition,
  evaluateExpression,
  ExpressionError,
  type EvalContext,
  type EvalResult,
} from "./expression-evaluator";
import { PhaseMachine } from "./phase-machine";
import type { MutableEvalContext, EffectDescription } from "./builtins";
import { registerAllBuiltins } from "./builtins";

/**
 * A valid action descriptor: the phase action name plus display info.
 * Returned by `getValidActions` so the UI can render action buttons.
 */
export interface ValidAction {
  /** The phase action's name (e.g., "hit", "stand", "double_down"). */
  readonly actionName: string;
  /** Display label for the UI. */
  readonly label: string;
  /** Whether the action's condition is currently met. */
  readonly enabled: boolean;
}

/**
 * Returns the list of valid actions for a player in the current state.
 * Uses the current phase's action definitions and evaluates their
 * conditions against the game state.
 *
 * When `phaseMachine` is not provided, one is constructed from the
 * state's ruleset phases (convenience for callers without a cached instance).
 */
export function getValidActions(
  state: CardGameState,
  playerId: PlayerId,
  phaseMachine?: PhaseMachine
): readonly ValidAction[] {
  // Ensure builtins are registered (idempotent) — needed when called
  // outside the reducer (e.g., from client-side getValidActions)
  registerAllBuiltins();

  // Guard: game must be in progress
  if (state.status.kind !== "in_progress") {
    return [];
  }

  // Resolve or construct the phase machine
  const machine = phaseMachine ?? new PhaseMachine(state.ruleset.phases);

  // Get current phase
  let phase;
  try {
    phase = machine.getPhase(state.currentPhase);
  } catch {
    return [];
  }

  // No player actions during automatic phases
  if (phase.kind === "automatic") {
    return [];
  }

  // Find the player's index
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return [];
  }

  // For turn_based phases: only the current player can act
  if (phase.kind === "turn_based" && state.currentPlayerIndex !== playerIndex) {
    return [];
  }

  // Build ValidAction for each phase action
  const result: ValidAction[] = [];

  for (const action of phase.actions) {
    // For play_card actions, inject sentinel played_card_index = -1
    // so builtins like played_card_matches_top() treat the action as
    // generically available (per-card filtering happens at play time).
    const bindings: Record<string, EvalResult> =
      action.name === "play_card"
        ? { played_card_index: { kind: "number", value: -1 } }
        : {};
    const ctx: EvalContext = { state, playerIndex, bindings };
    let enabled = true;

    if (action.condition) {
      try {
        enabled = evaluateCondition(action.condition, ctx);
      } catch (error) {
        if (error instanceof ExpressionError) {
          // Log the error for debuggability — never silently swallow
          console.warn(
            `[ActionValidator] Condition "${action.condition}" failed for action "${action.name}": ${error.message}`
          );
          enabled = false;
        } else {
          throw error;
        }
      }
    }

    result.push({
      actionName: action.name,
      label: action.label,
      enabled,
    });
  }

  return result;
}

/**
 * Returns the indices of cards in the current player's hand zone
 * that would satisfy the play_card action condition.
 *
 * Evaluates the `play_card` condition for each card in the player's
 * hand zone (`hand:${playerIndex}`) with `played_card_index` bound to
 * the card's index, rather than the sentinel `-1` used in
 * `getValidActions`.
 */
export function getPlayableCardIndices(
  state: CardGameState,
  ruleset: CardGameRuleset,
  playerIndex: number
): number[] {
  // Ensure builtins are registered (idempotent)
  registerAllBuiltins();

  // Resolve the current phase
  const machine = new PhaseMachine(ruleset.phases);
  let phase;
  try {
    phase = machine.getPhase(state.currentPhase);
  } catch {
    return [];
  }

  // Find the play_card action in the current phase
  const playCardAction = phase.actions.find((a) => a.name === "play_card");
  if (!playCardAction) {
    return [];
  }

  // Resolve the player's hand zone
  const handZoneName = `hand:${playerIndex}`;
  const handZone = state.zones[handZoneName];
  if (!handZone || handZone.cards.length === 0) {
    return [];
  }

  // If the play_card action has no condition, all cards are playable
  if (!playCardAction.condition) {
    return handZone.cards.map((_, i) => i);
  }

  // Evaluate the condition for each card index
  const playableIndices: number[] = [];

  for (let i = 0; i < handZone.cards.length; i++) {
    const ctx: EvalContext = {
      state,
      playerIndex,
      bindings: {
        played_card_index: { kind: "number", value: i },
      },
    };

    try {
      const conditionMet = evaluateCondition(playCardAction.condition, ctx);
      if (conditionMet) {
        playableIndices.push(i);
      }
    } catch (error) {
      if (error instanceof ExpressionError) {
        // Condition evaluation failed for this card — treat as not playable
        continue;
      }
      throw error;
    }
  }

  return playableIndices;
}

/**
 * Validates whether a specific action is legal in the current state.
 * Returns a discriminated result — not a boolean — so callers get
 * the rejection reason without a separate error channel.
 */
export function validateAction(
  state: CardGameState,
  action: CardGameAction,
  phaseMachine?: PhaseMachine
): ActionValidationResult {
  // Guard: game must be in progress for most actions
  if (state.status.kind !== "in_progress") {
    // start_game is valid when waiting for players
    if (action.kind === "start_game") {
      if (state.status.kind === "waiting_for_players") {
        return { valid: true };
      }
      return { valid: false, reason: "Game is not waiting for players" };
    }

    // join/leave are always valid (handled by framework)
    if (action.kind === "join" || action.kind === "leave") {
      return { valid: true };
    }

    return { valid: false, reason: "Game is not in progress" };
  }

  // Resolve or construct the phase machine
  const machine = phaseMachine ?? new PhaseMachine(state.ruleset.phases);

  switch (action.kind) {
    case "declare":
      return validateDeclareAction(state, action, machine);

    case "join":
    case "leave":
      // Always valid — handled by the CouchKit framework
      return { valid: true };

    case "start_game":
      // Can't start an already in-progress game
      return { valid: false, reason: "Game is already in progress" };

    case "advance_phase":
    case "reset_round":
      // Internal engine actions — valid during in_progress
      return { valid: true };

    case "play_card":
      return validatePlayCard(state, action, machine);

    case "draw_card":
      return validateDrawCard(state, action, machine);

    case "end_turn":
      return validateEndTurn(state, action, machine);
  }
}

/**
 * Validates a "declare" action against the current phase's action definitions.
 */
function validateDeclareAction(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "declare" }>,
  machine: PhaseMachine
): ActionValidationResult {
  let phase;
  try {
    phase = machine.getPhase(state.currentPhase);
  } catch {
    return { valid: false, reason: `Unknown phase: "${state.currentPhase}"` };
  }

  // Cannot act during automatic phases
  if (phase.kind === "automatic") {
    return { valid: false, reason: "Cannot act during automatic phase" };
  }

  // Find the player
  const playerIndex = state.players.findIndex(
    (p) => p.id === action.playerId
  );
  if (playerIndex === -1) {
    return { valid: false, reason: "Player not found" };
  }

  // For turn_based: verify it's the player's turn
  if (
    phase.kind === "turn_based" &&
    state.currentPlayerIndex !== playerIndex
  ) {
    return { valid: false, reason: "It is not your turn" };
  }

  // Look up the declaration in the phase's actions
  const phaseAction = phase.actions.find(
    (a) => a.name === action.declaration
  );
  if (!phaseAction) {
    return {
      valid: false,
      reason: `Action '${action.declaration}' not available in phase '${state.currentPhase}'`,
    };
  }

  // Evaluate the action's condition
  if (phaseAction.condition) {
    const ctx: EvalContext = { state, playerIndex };
    try {
      const conditionMet = evaluateCondition(phaseAction.condition, ctx);
      if (!conditionMet) {
        return {
          valid: false,
          reason: `Action condition not met: ${phaseAction.condition}`,
        };
      }
    } catch (error) {
      if (error instanceof ExpressionError) {
        return {
          valid: false,
          reason: `Action condition not met: ${phaseAction.condition}`,
        };
      }
      throw error;
    }
  }

  return { valid: true };
}

/**
 * Validates a "play_card" action: player exists, turn check, card exists,
 * and if a "play_card" phase action is defined, its condition is met.
 */
function validatePlayCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "play_card" }>,
  machine: PhaseMachine
): ActionValidationResult {
  const turnCheck = validatePlayerTurn(state, action.playerId, machine);
  if (!turnCheck.valid) return turnCheck;

  // Verify the card exists in fromZone
  const fromZone = state.zones[action.fromZone];
  if (!fromZone) {
    return { valid: false, reason: `Zone '${action.fromZone}' not found` };
  }

  const cardExists = fromZone.cards.some((c) => c.id === action.cardId);
  if (!cardExists) {
    return {
      valid: false,
      reason: `Card '${action.cardId}' not found in zone '${action.fromZone}'`,
    };
  }

  // Verify toZone exists
  if (!(action.toZone in state.zones)) {
    return { valid: false, reason: `Zone '${action.toZone}' not found` };
  }

  // If the current phase has a "play_card" action with a condition, validate it
  let phase;
  try {
    phase = machine.getPhase(state.currentPhase);
  } catch {
    // If phase can't be resolved, skip phase action condition check
    return { valid: true };
  }

  const playCardAction = phase.actions.find((a) => a.name === "play_card");
  if (playCardAction?.condition) {
    const playerIndex = state.players.findIndex(
      (p) => p.id === action.playerId
    );
    // Compute the index of the played card in fromZone for per-card validation
    const cardIndex = fromZone.cards.findIndex((c) => c.id === action.cardId);
    const ctx: EvalContext = {
      state,
      playerIndex,
      bindings: {
        played_card_index: { kind: "number", value: cardIndex },
      },
    };
    try {
      const conditionMet = evaluateCondition(playCardAction.condition, ctx);
      if (!conditionMet) {
        return {
          valid: false,
          reason: `Action condition not met: ${playCardAction.condition}`,
        };
      }
    } catch (error) {
      if (error instanceof ExpressionError) {
        return {
          valid: false,
          reason: `Action condition not met: ${playCardAction.condition}`,
        };
      }
      throw error;
    }
  }

  return { valid: true };
}

/**
 * Validates a "draw_card" action: player exists, turn check, zone has cards.
 */
function validateDrawCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "draw_card" }>,
  machine: PhaseMachine
): ActionValidationResult {
  const turnCheck = validatePlayerTurn(state, action.playerId, machine);
  if (!turnCheck.valid) return turnCheck;

  // Verify fromZone exists and has enough cards
  const fromZone = state.zones[action.fromZone];
  if (!fromZone) {
    return { valid: false, reason: `Zone '${action.fromZone}' not found` };
  }

  if (fromZone.cards.length < action.count) {
    return {
      valid: false,
      reason: `Zone '${action.fromZone}' has ${fromZone.cards.length} card(s), need ${action.count}`,
    };
  }

  // Verify toZone exists
  if (!(action.toZone in state.zones)) {
    return { valid: false, reason: `Zone '${action.toZone}' not found` };
  }

  return { valid: true };
}

/**
 * Validates an "end_turn" action: player exists, turn check.
 */
function validateEndTurn(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "end_turn" }>,
  machine: PhaseMachine
): ActionValidationResult {
  return validatePlayerTurn(state, action.playerId, machine);
}

/**
 * Common validation: player exists and (for turn_based phases) it's their turn.
 */
function validatePlayerTurn(
  state: CardGameState,
  playerId: PlayerId,
  machine: PhaseMachine
): ActionValidationResult {
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { valid: false, reason: "Player not found" };
  }

  let phase;
  try {
    phase = machine.getPhase(state.currentPhase);
  } catch {
    // Unknown phase — reject immediately; never allow actions on invalid state
    return { valid: false, reason: "Unknown phase" };
  }

  if (
    phase.kind === "turn_based" &&
    state.currentPlayerIndex !== playerIndex
  ) {
    return { valid: false, reason: "It is not your turn" };
  }

  return { valid: true };
}

/**
 * Executes a phase action's effects by evaluating its effect expressions.
 * Returns collected effect descriptions without mutating state.
 *
 * @param state - Current game state.
 * @param actionName - Name of the phase action to execute.
 * @param playerIndex - Index of the player performing the action.
 * @param phaseMachine - The phase machine for phase lookup.
 * @param actionParams - Optional params from a declare action, readable via get_param().
 * @returns Array of effect descriptions produced by the action's expressions.
 * @throws {Error} if the action is not found in the current phase.
 */
export function executePhaseAction(
  state: CardGameState,
  actionName: string,
  playerIndex: number,
  phaseMachine: PhaseMachine,
  actionParams?: Readonly<Record<string, string | number | boolean>>
): EffectDescription[] {
  const phase = phaseMachine.getPhase(state.currentPhase);
  const phaseAction = phase.actions.find((a) => a.name === actionName);

  if (!phaseAction) {
    throw new Error(
      `Action '${actionName}' not found in phase '${state.currentPhase}'`
    );
  }

  const context: MutableEvalContext = {
    state,
    playerIndex,
    effects: [],
    ...(actionParams ? { actionParams } : {}),
  };

  for (const expression of phaseAction.effect) {
    evaluateExpression(expression, context);
  }

  return context.effects;
}

/** Discriminated validation result — success or failure with reason. */
export type ActionValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };
