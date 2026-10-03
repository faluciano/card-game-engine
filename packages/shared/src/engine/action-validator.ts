// ─── Action Validator ──────────────────────────────────────────────
// Determines which actions are valid for a given player in the
// current game state. Prevents illegal moves at the engine level.

import type { CardGameAction, CardGameRuleset, CardGameState, PlayerId } from "../types/index";
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
import { perPlayerZone } from "./zone-names";

/** Shared success result — validation results are immutable, so one instance suffices. */
const VALID: ActionValidationResult = { valid: true };

/**
 * Evaluates a phase action's `condition` and maps the outcome onto a
 * validation result. An `ExpressionError` is reported as a rejection whose
 * reason carries the evaluator's message (which names the expression), so a
 * broken condition surfaces to the acting player instead of crashing the
 * reducer or being disguised as "condition not met".
 */
function checkActionCondition(condition: string, ctx: EvalContext): ActionValidationResult {
  try {
    return evaluateCondition(condition, ctx)
      ? VALID
      : { valid: false, reason: `Action condition not met: ${condition}` };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { valid: false, reason: `Action condition failed to evaluate: ${error.message}` };
    }
    throw error;
  }
}

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
  phaseMachine?: PhaseMachine,
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

  // No actions in an unknown phase, and no player actions during automatic phases
  const phase = machine.findPhase(state.currentPhase);
  if (!phase || phase.kind === "automatic") {
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
      action.name === "play_card" ? { played_card_index: { kind: "number", value: -1 } } : {};
    const ctx: EvalContext = { state, playerIndex, bindings };
    // Conditions are parse-checked at ruleset load; an ExpressionError here
    // is a real runtime failure and propagates to the caller.
    const enabled = action.condition ? evaluateCondition(action.condition, ctx) : true;

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
  playerIndex: number,
  phaseMachine?: PhaseMachine,
): number[] {
  // Ensure builtins are registered (idempotent)
  registerAllBuiltins();

  // Resolve the current phase
  const machine = phaseMachine ?? new PhaseMachine(ruleset.phases);
  const phase = machine.findPhase(state.currentPhase);

  // Find the play_card action in the current phase (none if the phase is unknown)
  const playCardAction = phase?.actions.find((a) => a.name === "play_card");
  if (!playCardAction) {
    return [];
  }

  // Resolve the player's hand zone
  const handZoneName = perPlayerZone("hand", playerIndex);
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

    if (evaluateCondition(playCardAction.condition, ctx)) {
      playableIndices.push(i);
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
  phaseMachine?: PhaseMachine,
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
    case "step_phase":
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
  machine: PhaseMachine,
): ActionValidationResult {
  const phase = machine.findPhase(state.currentPhase);
  if (!phase) {
    return { valid: false, reason: `Unknown phase: "${state.currentPhase}"` };
  }

  // Cannot act during automatic phases
  if (phase.kind === "automatic") {
    return { valid: false, reason: "Cannot act during automatic phase" };
  }

  // Find the player
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIndex === -1) {
    return { valid: false, reason: "Player not found" };
  }

  // For turn_based: verify it's the player's turn
  if (phase.kind === "turn_based" && state.currentPlayerIndex !== playerIndex) {
    return { valid: false, reason: "It is not your turn" };
  }

  // Look up the declaration in the phase's actions
  const phaseAction = phase.actions.find((a) => a.name === action.declaration);
  if (!phaseAction) {
    return {
      valid: false,
      reason: `Action '${action.declaration}' not available in phase '${state.currentPhase}'`,
    };
  }

  // Evaluate the action's condition. Declare params are exposed so a
  // condition can validate the player's choice via get_param(). A real
  // declare always carries a params record (empty if none were sent), so a
  // missing parameter is reported rather than read as the probe sentinel.
  if (phaseAction.condition) {
    const ctx: EvalContext = {
      state,
      playerIndex,
      actionParams: action.params ?? {},
    };
    return checkActionCondition(phaseAction.condition, ctx);
  }

  return VALID;
}

/**
 * Validates a "play_card" action: player exists, turn check, card exists,
 * and if a "play_card" phase action is defined, its condition is met.
 */
function validatePlayCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "play_card" }>,
  machine: PhaseMachine,
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
  // (validatePlayerTurn above already rejected unknown phases).
  const playCardAction = machine
    .findPhase(state.currentPhase)
    ?.actions.find((a) => a.name === "play_card");
  if (playCardAction?.condition) {
    const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
    // Compute the index of the played card in fromZone for per-card validation
    const cardIndex = fromZone.cards.findIndex((c) => c.id === action.cardId);
    const ctx: EvalContext = {
      state,
      playerIndex,
      bindings: {
        played_card_index: { kind: "number", value: cardIndex },
      },
    };
    return checkActionCondition(playCardAction.condition, ctx);
  }

  return VALID;
}

/**
 * Validates a "draw_card" action: player exists, turn check, zone has cards.
 */
function validateDrawCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "draw_card" }>,
  machine: PhaseMachine,
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
  machine: PhaseMachine,
): ActionValidationResult {
  return validatePlayerTurn(state, action.playerId, machine);
}

/**
 * Common validation: player exists and (for turn_based phases) it's their turn.
 */
function validatePlayerTurn(
  state: CardGameState,
  playerId: PlayerId,
  machine: PhaseMachine,
): ActionValidationResult {
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return { valid: false, reason: "Player not found" };
  }

  // Unknown phase — reject immediately; never allow actions on invalid state
  const phase = machine.findPhase(state.currentPhase);
  if (!phase) {
    return { valid: false, reason: "Unknown phase" };
  }

  if (phase.kind === "turn_based" && state.currentPlayerIndex !== playerIndex) {
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
  actionParams?: Readonly<Record<string, string | number | boolean>>,
): EffectDescription[] {
  const phase = phaseMachine.getPhase(state.currentPhase);
  const phaseAction = phase.actions.find((a) => a.name === actionName);

  if (!phaseAction) {
    throw new Error(`Action '${actionName}' not found in phase '${state.currentPhase}'`);
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
