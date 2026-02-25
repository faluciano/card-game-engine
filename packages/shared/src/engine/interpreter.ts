// ─── Ruleset Interpreter ───────────────────────────────────────────
// Transforms a static CardGameRuleset into runtime constructs:
// a reducer function, initial state factory, and phase machine.

import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
  CardInstanceId,
  Card,
  GameReducer,
  GameSessionId,
  Player,
  PlayerId,
  ZoneDefinition,
  ZoneState,
} from "../types/index";
import { parseRuleset } from "../schema/validation";
import { getPresetDeck, type CardTemplate } from "../deck/presets";
import { PhaseMachine } from "./phase-machine";
import {
  registerAllBuiltins,
  type EffectDescription,
  type MutableEvalContext,
} from "./builtins";
import { evaluateCondition, evaluateExpression, type EvalContext, type EvalResult } from "./expression-evaluator";
import {
  validateAction,
  executePhaseAction,
} from "./action-validator";
import { createRng, type SeededRng } from "./prng";
import { isHumanPlayer } from "./role-utils";

// ─── loadRuleset ───────────────────────────────────────────────────

/**
 * Loads and validates a raw JSON object into a trusted CardGameRuleset.
 * This is the parse boundary — after this, the ruleset is guaranteed valid.
 *
 * @throws {RulesetParseError} if the JSON does not conform to the schema.
 */
export function loadRuleset(raw: unknown): CardGameRuleset {
  try {
    return parseRuleset(raw) as CardGameRuleset;
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "issues" in error &&
      Array.isArray((error as { issues: unknown[] }).issues)
    ) {
      const zodError = error as {
        issues: Array<{ path: (string | number)[]; message: string }>;
      };
      const formattedIssues = zodError.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      throw new RulesetParseError(
        `Invalid ruleset: ${formattedIssues.length} issue(s)`,
        formattedIssues
      );
    }
    throw error;
  }
}

// ─── createInitialState ────────────────────────────────────────────

/**
 * Creates the initial game state for a ruleset with the given players.
 * Sets up the deck and zones per the ruleset, placing all cards in the
 * draw pile. Does NOT shuffle or deal — that happens when start_game
 * triggers the first automatic phase.
 */
export function createInitialState(
  ruleset: CardGameRuleset,
  sessionId: GameSessionId,
  players: readonly Player[],
  seed: number = Date.now()
): CardGameState {
  if (players.length < ruleset.meta.players.min) {
    throw new RangeError(
      `Need at least ${ruleset.meta.players.min} players, got ${players.length}`
    );
  }
  if (players.length > ruleset.meta.players.max) {
    throw new RangeError(
      `At most ${ruleset.meta.players.max} players allowed, got ${players.length}`
    );
  }

  const rng = createRng(seed);

  // Build deck from preset templates or custom card definitions
  const templates =
    ruleset.deck.preset === "custom"
      ? ruleset.deck.cards
      : getPresetDeck(ruleset.deck.preset);
  const allCards = createDeterministicCards(templates, ruleset.deck.copies, rng);

  // Initialize zones
  const zones = initializeZones(ruleset, players, allCards);

  return {
    sessionId,
    ruleset,
    status: { kind: "waiting_for_players" },
    players: [...players],
    zones,
    currentPhase: ruleset.phases[0]!.name,
    currentPlayerIndex: 0,
    turnNumber: 1,
    turnDirection: 1,
    scores: {},
    variables: { ...(ruleset.initialVariables ?? {}) },
    actionLog: [],
    turnsTakenThisPhase: 0,
    version: 0,
  };
}

// ─── createReducer ─────────────────────────────────────────────────

/**
 * Creates a pure reducer function bound to a specific ruleset.
 * The reducer handles all game actions according to the ruleset's
 * phases, rules, and transitions.
 */
export function createReducer(
  ruleset: CardGameRuleset,
  seed: number = Date.now()
): GameReducer {
  // Ensure builtins are registered (idempotent)
  registerAllBuiltins();

  const phaseMachine = new PhaseMachine(ruleset.phases);
  const rng = createRng(seed);

  return (state: CardGameState, action: CardGameAction): CardGameState => {
    switch (action.kind) {
      case "join":
        return handleJoin(state, action);
      case "leave":
        return handleLeave(state, action);
      case "start_game":
        return handleStartGame(state, phaseMachine, rng);
      case "declare":
        return handleDeclare(state, action, phaseMachine, rng);
      case "play_card":
        return handlePlayCard(state, action, phaseMachine, rng);
      case "draw_card":
        return handleDrawCard(state, action, phaseMachine);
      case "end_turn":
        return handleEndTurn(state, action, phaseMachine, rng);
      case "advance_phase":
        return handleAdvancePhase(state, phaseMachine, rng);
      case "reset_round":
        return handleResetRound(state, phaseMachine, rng);
    }
  };
}

// ─── Action Handlers ───────────────────────────────────────────────

/**
 * Handles a "join" action — adds a player or reconnects an existing one.
 */
function handleJoin(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "join" }>
): CardGameState {
  const existingIndex = state.players.findIndex(
    (p) => p.id === action.playerId
  );

  if (existingIndex !== -1) {
    // Reconnect existing player
    const updated = state.players.map((p, i) =>
      i === existingIndex ? { ...p, connected: true } : p
    );
    return {
      ...state,
      players: updated,
      version: state.version + 1,
      actionLog: [
        ...state.actionLog,
        { action, timestamp: Date.now(), version: state.version + 1 },
      ],
    };
  }

  // Add new player
  const newPlayer: Player = {
    id: action.playerId,
    name: action.name,
    role: "player",
    connected: true,
  };

  return {
    ...state,
    players: [...state.players, newPlayer],
    version: state.version + 1,
    actionLog: [
      ...state.actionLog,
      { action, timestamp: Date.now(), version: state.version + 1 },
    ],
  };
}

/**
 * Handles a "leave" action — marks a player as disconnected.
 * Does not remove the player (CouchKit handles reconnection).
 */
function handleLeave(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "leave" }>
): CardGameState {
  const playerIndex = state.players.findIndex(
    (p) => p.id === action.playerId
  );
  if (playerIndex === -1) return state;

  const updated = state.players.map((p, i) =>
    i === playerIndex ? { ...p, connected: false } : p
  );

  return {
    ...state,
    players: updated,
    version: state.version + 1,
    actionLog: [
      ...state.actionLog,
      { action, timestamp: Date.now(), version: state.version + 1 },
    ],
  };
}

/**
 * Handles a "start_game" action — transitions from waiting to in_progress,
 * then runs automatic phases (e.g., deal).
 */
function handleStartGame(
  state: CardGameState,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  // Guard: must be waiting for players
  if (state.status.kind !== "waiting_for_players") {
    return state;
  }

  // Check minimum player count
  if (state.players.length < state.ruleset.meta.players.min) {
    return state;
  }

  let newState: CardGameState = {
    ...state,
    status: { kind: "in_progress", startedAt: Date.now() },
    version: state.version + 1,
    actionLog: [
      ...state.actionLog,
      {
        action: { kind: "start_game" },
        timestamp: Date.now(),
        version: state.version + 1,
      },
    ],
  };

  // Run automatic phases (e.g., deal phase in blackjack)
  newState = runAutomaticPhases(newState, phaseMachine, rng);

  return newState;
}

/**
 * Handles a "declare" action — validates, executes effects, checks transitions.
 */
function handleDeclare(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "declare" }>,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const validation = validateAction(state, action, phaseMachine);
  if (!validation.valid) return state;

  const playerIndex = state.players.findIndex(
    (p) => p.id === action.playerId
  );

  const effects = executePhaseAction(
    state,
    action.declaration,
    playerIndex,
    phaseMachine,
    action.params
  );

  let newState = applyEffects(state, effects, rng);

  // ── Auto-end turn via expression ───────────────────────────────
  // If the ruleset defines autoEndTurnCondition and the action didn't
  // already end the turn, evaluate the condition for the current player.
  // Examples: "hand_value(current_player.hand, 21) >= 21" (blackjack)
  const { autoEndTurnCondition } = newState.ruleset.scoring;
  if (
    autoEndTurnCondition &&
    !effects.some((e) => e.kind === "end_turn") &&
    newState.currentPlayerIndex === state.currentPlayerIndex
  ) {
    const ctx: EvalContext = { state: newState, playerIndex };
    if (evaluateCondition(autoEndTurnCondition, ctx)) {
      newState = applyEndTurnEffect(newState);
    }
  }

  // Bump version and log
  newState = {
    ...newState,
    version: newState.version + 1,
    actionLog: [
      ...newState.actionLog,
      { action, timestamp: Date.now(), version: newState.version + 1 },
    ],
  };

  // Check transitions after the action
  newState = checkTransitionsAndRunAuto(newState, phaseMachine, rng);

  return newState;
}

/**
 * Handles a "play_card" action — moves a specific card between zones,
 * then executes any "play_card" phase action effects, checks auto-end-turn,
 * and runs transitions.
 */
function handlePlayCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "play_card" }>,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const validation = validateAction(state, action, phaseMachine);
  if (!validation.valid) return state;

  // ── Move the card between zones ────────────────────────────────
  const zones = { ...state.zones };
  const fromZone = zones[action.fromZone]!;
  const toZone = zones[action.toZone]!;

  const cardIndex = fromZone.cards.findIndex((c) => c.id === action.cardId);
  if (cardIndex === -1) return state;

  const card = fromZone.cards[cardIndex]!;
  const newFromCards = fromZone.cards.filter((_, i) => i !== cardIndex);
  const newToCards = [...toZone.cards, card];

  zones[action.fromZone] = { ...fromZone, cards: newFromCards };
  zones[action.toZone] = { ...toZone, cards: newToCards };

  let newState: CardGameState = { ...state, zones };

  // ── Execute phase action effects (if "play_card" action exists) ─
  const playerIndex = state.players.findIndex(
    (p) => p.id === action.playerId
  );

  let phase;
  try {
    phase = phaseMachine.getPhase(state.currentPhase);
  } catch {
    phase = undefined;
  }

  const playCardAction = phase?.actions.find((a) => a.name === "play_card");

  if (playCardAction) {
    const effects = executePhaseAction(
      newState,
      "play_card",
      playerIndex,
      phaseMachine
    );

    newState = applyEffects(newState, effects, rng);

    // ── Auto-end turn via expression ─────────────────────────────
    const { autoEndTurnCondition } = newState.ruleset.scoring;
    if (
      autoEndTurnCondition &&
      !effects.some((e) => e.kind === "end_turn") &&
      newState.currentPlayerIndex === state.currentPlayerIndex
    ) {
      const ctx: EvalContext = { state: newState, playerIndex };
      if (evaluateCondition(autoEndTurnCondition, ctx)) {
        newState = applyEndTurnEffect(newState);
      }
    }
  }

  // Bump version and log
  newState = {
    ...newState,
    version: newState.version + 1,
    actionLog: [
      ...newState.actionLog,
      { action, timestamp: Date.now(), version: newState.version + 1 },
    ],
  };

  // Check transitions after the action
  if (playCardAction) {
    newState = checkTransitionsAndRunAuto(newState, phaseMachine, rng);
  }

  return newState;
}

/**
 * Handles a "draw_card" action — moves N cards from one zone to another.
 */
function handleDrawCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "draw_card" }>,
  phaseMachine: PhaseMachine
): CardGameState {
  const validation = validateAction(state, action, phaseMachine);
  if (!validation.valid) return state;

  const zones = { ...state.zones };
  const fromZone = zones[action.fromZone]!;
  const toZone = zones[action.toZone]!;

  const fromCards = [...fromZone.cards];
  const drawnCards = fromCards.splice(0, action.count);

  zones[action.fromZone] = { ...fromZone, cards: fromCards };
  zones[action.toZone] = { ...toZone, cards: [...toZone.cards, ...drawnCards] };

  return {
    ...state,
    zones,
    version: state.version + 1,
    actionLog: [
      ...state.actionLog,
      { action, timestamp: Date.now(), version: state.version + 1 },
    ],
  };
}

/**
 * Handles an "end_turn" action — advances to next player, checks transitions.
 */
function handleEndTurn(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "end_turn" }>,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const validation = validateAction(state, action, phaseMachine);
  if (!validation.valid) return state;

  const humanPlayers = state.players.filter((p) => isHumanPlayer(p, state.ruleset.roles));
  const count = humanPlayers.length;
  const nextPlayerIndex =
    ((state.currentPlayerIndex + state.turnDirection) % count + count) % count;

  let newState: CardGameState = {
    ...state,
    currentPlayerIndex: nextPlayerIndex,
    turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
    version: state.version + 1,
    actionLog: [
      ...state.actionLog,
      { action, timestamp: Date.now(), version: state.version + 1 },
    ],
  };

  // Check transitions (e.g., all_players_done triggers phase change)
  newState = checkTransitionsAndRunAuto(newState, phaseMachine, rng);

  return newState;
}

/**
 * Handles an "advance_phase" internal action.
 */
function handleAdvancePhase(
  state: CardGameState,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const transition = phaseMachine.evaluateTransitions(state);
  if (transition.kind === "stay") return state;

  let newState: CardGameState = {
    ...state,
    currentPhase: transition.nextPhase,
    turnsTakenThisPhase: 0,
    version: state.version + 1,
  };

  newState = runAutomaticPhases(newState, phaseMachine, rng);
  return newState;
}

/**
 * Handles a "reset_round" internal action.
 */
function handleResetRound(
  state: CardGameState,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const firstPhase = state.ruleset.phases[0]!.name;

  let newState: CardGameState = {
    ...state,
    currentPhase: firstPhase,
    currentPlayerIndex: 0,
    turnNumber: state.turnNumber + 1,
    turnsTakenThisPhase: 0,
    turnDirection: 1,
    scores: {},
    variables: { ...(state.ruleset.initialVariables ?? {}) },
    version: state.version + 1,
  };

  newState = runAutomaticPhases(newState, phaseMachine, rng);
  return newState;
}

// ─── Automatic Phase Execution ─────────────────────────────────────

/** Safety limit for automatic phase loops to prevent infinite loops. */
const MAX_PHASE_ITERATIONS = 50;

/**
 * Runs automatic phases in sequence until a non-automatic phase is reached
 * or no transition is available.
 */
function runAutomaticPhases(
  state: CardGameState,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  let current = state;
  let iterations = 0;

  while (iterations < MAX_PHASE_ITERATIONS) {
    if (!phaseMachine.isAutomaticPhase(current.currentPhase)) {
      break;
    }

    // Execute the automatic sequence with an effect-flushing callback.
    // This allows `while()` loops to apply effects between iterations
    // so condition re-evaluation sees updated state (e.g., drawn cards).
    const phase = phaseMachine.getPhase(current.currentPhase);
    if (phase.automaticSequence && phase.automaticSequence.length > 0) {
      const ctx: MutableEvalContext = {
        state: current,
        effects: [],
        applyEffectsToState: (s, effs) => applyEffects(s, effs, rng),
      };
      for (const expression of phase.automaticSequence) {
        evaluateExpression(expression, ctx);
      }
      // Apply any remaining unflushed effects
      current = applyEffects(ctx.state, ctx.effects, rng);
    }

    // Evaluate transitions
    const transition = phaseMachine.evaluateTransitions(current);
    if (transition.kind === "stay") {
      break;
    }

    // Advance to next phase
    current = {
      ...current,
      currentPhase: transition.nextPhase,
      turnsTakenThisPhase: 0,
      version: current.version + 1,
    };
    iterations++;
  }

  return current;
}

/**
 * Checks transitions on current state, and if a phase change occurs,
 * runs automatic phases that follow.
 */
function checkTransitionsAndRunAuto(
  state: CardGameState,
  phaseMachine: PhaseMachine,
  rng: SeededRng
): CardGameState {
  const transition = phaseMachine.evaluateTransitions(state);
  if (transition.kind === "stay") {
    return state;
  }

  let newState: CardGameState = {
    ...state,
    currentPhase: transition.nextPhase,
    turnsTakenThisPhase: 0,
    version: state.version + 1,
  };

  newState = runAutomaticPhases(newState, phaseMachine, rng);
  return newState;
}

// ─── Effect Application ────────────────────────────────────────────

/**
 * Applies a sequence of effect descriptions to produce a new state.
 * Pure — does not mutate the input state.
 */
function applyEffects(
  state: CardGameState,
  effects: readonly EffectDescription[],
  rng: SeededRng
): CardGameState {
  let current = state;
  for (const effect of effects) {
    current = applySingleEffect(current, effect, rng);
  }
  return current;
}

/**
 * Dispatches a single effect description to the appropriate handler.
 */
function applySingleEffect(
  state: CardGameState,
  effect: EffectDescription,
  rng: SeededRng
): CardGameState {
  switch (effect.kind) {
    case "shuffle":
      return applyShuffleEffect(state, effect.params, rng);
    case "deal":
      return applyDealEffect(state, effect.params);
    case "draw":
      return applyDrawEffect(state, effect.params);
    case "set_face_up":
      return applySetFaceUpEffect(state, effect.params);
    case "reveal_all":
      return applyRevealAllEffect(state, effect.params);
    case "end_turn":
      return applyEndTurnEffect(state);
    case "calculate_scores":
      return applyCalculateScoresEffect(state);
    case "determine_winners":
      return applyDetermineWinnersEffect(state);
    case "collect_all_to":
      return applyCollectAllToEffect(state, effect.params);
    case "reset_round":
      return applyResetRoundEffect(state);
    case "move_top":
      return applyMoveTopEffect(state, effect.params);
    case "flip_top":
      return applyFlipTopEffect(state, effect.params);
    case "move_all":
      return applyMoveAllEffect(state, effect.params);
    case "reverse_turn_order":
      return applyReverseTurnOrderEffect(state);
    case "skip_next_player":
      return applySkipNextPlayerEffect(state);
    case "set_next_player":
      return applySetNextPlayerEffect(state, effect.params);
    case "set_var":
      return applySetVarEffect(state, effect.params);
    case "inc_var":
      return applyIncVarEffect(state, effect.params);
    case "collect_trick":
      return applyCollectTrickEffect(state, effect.params);
    case "set_lead_player":
      return applySetLeadPlayerEffect(state, effect.params);
    case "end_game":
      return applyEndGameEffect(state);
    case "accumulate_scores":
      return applyAccumulateScoresEffect(state);
    default:
      // Unknown effects are ignored — forward compatible
      return state;
  }
}

// ─── Effect Implementations ────────────────────────────────────────

/**
 * Shuffles all cards in a zone using the seeded RNG.
 */
function applyShuffleEffect(
  state: CardGameState,
  params: Record<string, unknown>,
  rng: SeededRng
): CardGameState {
  const zoneName = params.zone as string;
  const zone = state.zones[zoneName];
  if (!zone) return state;

  const shuffled = rng.shuffle(zone.cards);
  return {
    ...state,
    zones: {
      ...state.zones,
      [zoneName]: { ...zone, cards: shuffled },
    },
  };
}

/**
 * Deals cards from a source zone to all per-player target zones.
 * For each player zone matching the template (e.g., "hand:0", "hand:1"),
 * moves `count` cards from the source.
 * Also handles non-per-player zones (e.g., "dealer_hand").
 */
function applyDealEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const from = params.from as string;
  const to = params.to as string;
  const count = params.count as number;

  const zones = { ...state.zones };
  const fromZone = zones[from];
  if (!fromZone) return state;

  let fromCards = [...fromZone.cards];

  // Find all per-player variants of the "to" zone, or the exact zone
  const targetZones = Object.keys(zones).filter(
    (name) => name === to || name.startsWith(`${to}:`)
  );

  // If no matching zones, return unchanged
  if (targetZones.length === 0) return state;

  for (const targetZone of targetZones) {
    const cardsToMove = fromCards.splice(0, count);
    const existing = zones[targetZone]!;
    zones[targetZone] = {
      ...existing,
      cards: [...existing.cards, ...cardsToMove],
    };
  }

  zones[from] = { ...fromZone, cards: fromCards };
  return { ...state, zones };
}

/**
 * Draws cards from a source zone to a target zone for the current player.
 * Resolves per-player zone names if needed.
 */
function applyDrawEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const from = params.from as string;
  const to = params.to as string;
  const count = params.count as number;

  const zones = { ...state.zones };
  const fromZone = zones[from];
  if (!fromZone) return state;

  // Resolve target zone — might be per-player
  let targetZone = to;
  if (!(targetZone in zones)) {
    const perPlayerName = `${to}:${state.currentPlayerIndex}`;
    if (perPlayerName in zones) {
      targetZone = perPlayerName;
    }
  }

  const target = zones[targetZone];
  if (!target) return state;

  const fromCards = [...fromZone.cards];
  const drawnCards = fromCards.splice(0, count);

  zones[from] = { ...fromZone, cards: fromCards };
  zones[targetZone] = { ...target, cards: [...target.cards, ...drawnCards] };

  return { ...state, zones };
}

/**
 * Sets a specific card's faceUp property in a zone.
 */
function applySetFaceUpEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const zoneName = params.zone as string;
  const cardIndex = params.cardIndex as number;
  const faceUp = params.faceUp as boolean;

  const zone = state.zones[zoneName];
  if (!zone || cardIndex < 0 || cardIndex >= zone.cards.length) return state;

  const updatedCards = zone.cards.map((card, i) =>
    i === cardIndex ? { ...card, faceUp } : card
  );

  return {
    ...state,
    zones: {
      ...state.zones,
      [zoneName]: { ...zone, cards: updatedCards },
    },
  };
}

/**
 * Sets all cards in a zone to faceUp: true.
 */
function applyRevealAllEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const zoneName = params.zone as string;
  const zone = state.zones[zoneName];
  if (!zone) return state;

  const revealedCards = zone.cards.map((card) => ({ ...card, faceUp: true }));

  return {
    ...state,
    zones: {
      ...state.zones,
      [zoneName]: { ...zone, cards: revealedCards },
    },
  };
}

/**
 * Advances currentPlayerIndex to the next human player. Wraps around.
 */
function applyEndTurnEffect(state: CardGameState): CardGameState {
  const humanPlayers = state.players.filter((p) => isHumanPlayer(p, state.ruleset.roles));
  const count = humanPlayers.length;
  const nextIndex = ((state.currentPlayerIndex + state.turnDirection) % count + count) % count;

  return {
    ...state,
    currentPlayerIndex: nextIndex,
    turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
  };
}

/**
 * Derives a zone map for an NPC role by finding zones it owns.
 * Strips the "{roleName}_" prefix to produce base keys.
 * Example: for dealer, "dealer_hand" → { hand: "dealer_hand" }
 */
function buildNpcZoneMap(
  roleName: string,
  zones: Readonly<Record<string, { readonly definition: { readonly owners: readonly string[] } }>>
): Readonly<Record<string, string>> {
  const zoneMap: Record<string, string> = {};
  const prefix = `${roleName}_`;
  for (const zoneName of Object.keys(zones)) {
    const zone = zones[zoneName]!;
    if (zone.definition.owners.includes(roleName)) {
      // Strip role prefix if present; otherwise use zone name as-is
      const baseKey = zoneName.startsWith(prefix)
        ? zoneName.substring(prefix.length)
        : zoneName;
      zoneMap[baseKey] = zoneName;
    }
  }
  return zoneMap;
}

/**
 * Calculates scores for all entities using the ruleset's scoring expression.
 * Evaluates `scoring.method` per human player and per NPC role.
 * Stores results as "player_score:N" for humans, "{role}_score" for NPCs.
 */
function applyCalculateScoresEffect(state: CardGameState): CardGameState {
  const { roles, scoring } = state.ruleset;
  const scores: Record<string, number> = {};

  for (const role of roles) {
    if (role.isHuman) {
      // Score each human player
      for (let i = 0; i < state.players.length; i++) {
        const player = state.players[i]!;
        if (!isHumanPlayer(player, roles)) continue;

        const ctx: EvalContext = { state, playerIndex: i };
        const result = evaluateExpression(scoring.method, ctx);
        if (result.kind !== "number") {
          throw new Error(
            `scoring.method must return a number, got ${result.kind} for player ${i}`
          );
        }
        scores[`player_score:${i}`] = result.value;
      }
    } else {
      // Score each NPC role
      const zoneMap = buildNpcZoneMap(role.name, state.zones);
      const ctx: EvalContext = {
        state,
        roleOverride: { roleName: role.name, zoneMap },
      };
      const result = evaluateExpression(scoring.method, ctx);
      if (result.kind !== "number") {
        throw new Error(
          `scoring.method must return a number, got ${result.kind} for role "${role.name}"`
        );
      }
      scores[`${role.name}_score`] = result.value;
    }
  }

  return { ...state, scores };
}

/**
 * Determines round results by evaluating bust/win/tie conditions per player.
 * Evaluation order: bust → win → tie → loss (default).
 * Results stored as "result:N" where 1=win, 0=tie, -1=loss.
 */
function applyDetermineWinnersEffect(state: CardGameState): CardGameState {
  const { scoring, roles } = state.ruleset;
  const scores = { ...state.scores };

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i]!;
    if (!isHumanPlayer(player, roles)) continue;

    const myScore = scores[`player_score:${i}`] ?? 0;
    const bindings: Record<string, EvalResult> = {
      my_score: { kind: "number", value: myScore },
    };
    const ctx: EvalContext = { state: { ...state, scores }, playerIndex: i, bindings };

    // Evaluation order: bust → win → tie → loss
    if (scoring.bustCondition && evaluateCondition(scoring.bustCondition, ctx)) {
      scores[`result:${i}`] = -1;
    } else if (evaluateCondition(scoring.winCondition, ctx)) {
      scores[`result:${i}`] = 1;
    } else if (scoring.tieCondition && evaluateCondition(scoring.tieCondition, ctx)) {
      scores[`result:${i}`] = 0;
    } else {
      scores[`result:${i}`] = -1;
    }
  }

  return { ...state, scores };
}

/**
 * Collects all cards from all zones into the specified target zone.
 */
function applyCollectAllToEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const targetName = params.zone as string;
  const zones = { ...state.zones };
  const collected: Card[] = [];

  // Gather all cards from all zones
  for (const [name, zone] of Object.entries(zones)) {
    if (name === targetName) continue;
    collected.push(...zone.cards.map((card) => ({ ...card, faceUp: false })));
    zones[name] = { ...zone, cards: [] };
  }

  const target = zones[targetName];
  if (target) {
    zones[targetName] = {
      ...target,
      cards: [...target.cards, ...collected],
    };
  }

  return { ...state, zones };
}

/**
 * Resets the round: clears scores, resets player index, increments turn.
 */
function applyResetRoundEffect(state: CardGameState): CardGameState {
  // Preserve cumulative_score_* variables across round resets
  const preserved: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.variables)) {
    if (key.startsWith("cumulative_score_")) {
      preserved[key] = value;
    }
  }

  return {
    ...state,
    currentPlayerIndex: 0,
    turnNumber: state.turnNumber + 1,
    turnsTakenThisPhase: 0,
    turnDirection: 1,
    scores: {},
    variables: { ...(state.ruleset.initialVariables ?? {}), ...preserved },
  };
}

/**
 * Sets a custom variable to a specific value.
 */
function applySetVarEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const name = params.name as string;
  const value = params.value as number;
  return {
    ...state,
    variables: { ...state.variables, [name]: value },
  };
}

/**
 * Increments a custom variable by an amount.
 * If the variable doesn't exist yet, treats it as starting from 0.
 */
function applyIncVarEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const name = params.name as string;
  const amount = params.amount as number;
  const current = state.variables[name] ?? 0;
  return {
    ...state,
    variables: { ...state.variables, [name]: current + amount },
  };
}

/**
 * Moves the top N cards from one zone to another.
 * If the source zone has fewer cards than `count`, moves all available.
 * Preserves card state (faceUp, etc.).
 */
function applyMoveTopEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const fromName = params.from as string;
  const toName = params.to as string;
  const count = params.count as number;

  const zones = { ...state.zones };
  const fromZone = zones[fromName];
  const toZone = zones[toName];
  if (!fromZone || !toZone) return state;

  const fromCards = [...fromZone.cards];
  const movedCards = fromCards.splice(0, count);

  zones[fromName] = { ...fromZone, cards: fromCards };
  zones[toName] = { ...toZone, cards: [...toZone.cards, ...movedCards] };

  return { ...state, zones };
}

/**
 * Flips the top N cards in a zone to faceUp = true.
 * If the zone has fewer cards than `count`, flips all.
 */
function applyFlipTopEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const zoneName = params.zone as string;
  const count = params.count as number;

  const zone = state.zones[zoneName];
  if (!zone) return state;

  const updatedCards = zone.cards.map((card, i) =>
    i < count ? { ...card, faceUp: true } : card
  );

  return {
    ...state,
    zones: {
      ...state.zones,
      [zoneName]: { ...zone, cards: updatedCards },
    },
  };
}

/**
 * Moves ALL cards from one zone to another.
 * Cards retain their faceUp state.
 */
function applyMoveAllEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const fromName = params.from as string;
  const toName = params.to as string;

  const zones = { ...state.zones };
  const fromZone = zones[fromName];
  const toZone = zones[toName];
  if (!fromZone || !toZone) return state;

  zones[fromName] = { ...fromZone, cards: [] };
  zones[toName] = { ...toZone, cards: [...toZone.cards, ...fromZone.cards] };

  return { ...state, zones };
}

/**
 * Reverses the turn direction. Clockwise becomes counterclockwise and vice versa.
 */
function applyReverseTurnOrderEffect(state: CardGameState): CardGameState {
  return {
    ...state,
    turnDirection: state.turnDirection === 1 ? -1 : 1,
  };
}

/**
 * Skips the next player by advancing the current player index by one extra step
 * in the current turn direction.
 */
function applySkipNextPlayerEffect(state: CardGameState): CardGameState {
  const humanPlayers = state.players.filter((p) => isHumanPlayer(p, state.ruleset.roles));
  const count = humanPlayers.length;
  const nextIndex = ((state.currentPlayerIndex + state.turnDirection) % count + count) % count;
  return {
    ...state,
    currentPlayerIndex: nextIndex,
  };
}

/**
 * Sets the current player to a specific index.
 */
function applySetNextPlayerEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const playerIndex = params.playerIndex as number;
  const humanPlayers = state.players.filter((p) => isHumanPlayer(p, state.ruleset.roles));
  if (playerIndex < 0 || playerIndex >= humanPlayers.length) return state;
  return {
    ...state,
    currentPlayerIndex: playerIndex,
  };
}

/**
 * Collects all cards from every `{prefix}:{N}` zone into a target zone.
 * Cards are set face-down (they go into a won pile, not displayed).
 * Source zones are emptied.
 */
function applyCollectTrickEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const zonePrefix = params.zonePrefix as string;
  const targetZoneName = params.targetZone as string;
  const playerCount = state.players.length;

  const zones = { ...state.zones };
  const collected: Card[] = [];

  for (let i = 0; i < playerCount; i++) {
    const zoneName = `${zonePrefix}:${i}`;
    const zone = zones[zoneName];
    if (!zone) continue;
    collected.push(...zone.cards.map((card) => ({ ...card, faceUp: false })));
    zones[zoneName] = { ...zone, cards: [] };
  }

  const target = zones[targetZoneName];
  if (target) {
    zones[targetZoneName] = {
      ...target,
      cards: [...target.cards, ...collected],
    };
  }

  return { ...state, zones };
}

/**
 * Sets `variables.lead_player` to the given player index AND sets
 * `currentPlayerIndex` to that player, so the trick winner leads next.
 */
function applySetLeadPlayerEffect(
  state: CardGameState,
  params: Record<string, unknown>
): CardGameState {
  const playerIndex = params.playerIndex as number;
  return {
    ...state,
    variables: { ...state.variables, lead_player: playerIndex },
    currentPlayerIndex: playerIndex,
  };
}

/**
 * Transitions the game status to `{ kind: "finished" }`.
 * The winnerId is derived from scores: the player with `result:N === 1`.
 * If no clear winner, winnerId is null.
 */
function applyEndGameEffect(state: CardGameState): CardGameState {
  let winnerId: PlayerId | null = null;

  for (let i = 0; i < state.players.length; i++) {
    if (state.scores[`result:${i}`] === 1) {
      winnerId = state.players[i]!.id;
      break;
    }
  }

  return {
    ...state,
    status: {
      kind: "finished",
      finishedAt: Date.now(),
      winnerId,
    },
  };
}

/**
 * Accumulates each human player's round score into their cumulative score variable.
 * Reads scores["player_score:{i}"] and adds to variables["cumulative_score_{i}"].
 */
function applyAccumulateScoresEffect(state: CardGameState): CardGameState {
  const variables = { ...state.variables };
  const { roles } = state.ruleset;

  for (let i = 0; i < state.players.length; i++) {
    if (!isHumanPlayer(state.players[i]!, roles)) continue;
    const roundScore = state.scores[`player_score:${i}`] ?? 0;
    const key = `cumulative_score_${i}`;
    variables[key] = (variables[key] ?? 0) + roundScore;
  }

  return { ...state, variables };
}

// ─── Deterministic Card Creation ───────────────────────────────────

/**
 * Creates Card instances from templates with deterministic IDs from the seeded RNG.
 * This avoids crypto.randomUUID() which isn't deterministic.
 */
function createDeterministicCards(
  templates: readonly CardTemplate[],
  copies: number,
  rng: SeededRng
): Card[] {
  const cards: Card[] = [];
  for (let copy = 0; copy < copies; copy++) {
    for (const template of templates) {
      cards.push({
        id: generateDeterministicId(rng) as CardInstanceId,
        suit: template.suit,
        rank: template.rank,
        faceUp: false,
      });
    }
  }
  return cards;
}

/**
 * Generates a deterministic hex string ID from seeded random values.
 */
function generateDeterministicId(rng: SeededRng): string {
  const a = Math.floor(rng.next() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  const b = Math.floor(rng.next() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `card-${a}-${b}`;
}

// ─── Zone Initialization ───────────────────────────────────────────

/**
 * Initializes all zones from the ruleset configuration.
 * Per-player zones (owned by a "per_player" role) are expanded into
 * `{name}:{playerIndex}` variants. All cards are placed in the draw pile.
 */
function initializeZones(
  ruleset: CardGameRuleset,
  players: readonly Player[],
  allCards: readonly Card[]
): Record<string, ZoneState> {
  const zones: Record<string, ZoneState> = {};

  // Build set of per-player role names
  const perPlayerRoles = new Set(
    ruleset.roles
      .filter((r) => r.count === "per_player")
      .map((r) => r.name)
  );

  for (const zoneConfig of ruleset.zones) {
    const isPerPlayer = zoneConfig.owners.some((o) =>
      perPlayerRoles.has(o)
    );

    if (isPerPlayer) {
      // Create one zone per human player
      const humanPlayers = players.filter((p) => isHumanPlayer(p, ruleset.roles));
      for (let i = 0; i < humanPlayers.length; i++) {
        const name = `${zoneConfig.name}:${i}`;
        const definition: ZoneDefinition = {
          name,
          visibility: zoneConfig.visibility,
          owners: zoneConfig.owners,
          maxCards: zoneConfig.maxCards,
        };
        zones[name] = { definition, cards: [] };
      }
    } else {
      const definition: ZoneDefinition = {
        name: zoneConfig.name,
        visibility: zoneConfig.visibility,
        owners: zoneConfig.owners,
        maxCards: zoneConfig.maxCards,
      };
      zones[zoneConfig.name] = { definition, cards: [] };
    }
  }

  // Put all cards in the draw pile
  const drawPile = zones["draw_pile"];
  if (drawPile) {
    zones["draw_pile"] = { ...drawPile, cards: [...allCards] };
  } else {
    // Fallback: find first ownerless zone
    const ownerless = Object.entries(zones).find(
      ([_, z]) => z.definition.owners.length === 0
    );
    if (ownerless) {
      const [name, zone] = ownerless;
      zones[name] = { ...zone, cards: [...allCards] };
    }
  }

  return zones;
}

// ─── Error Types ───────────────────────────────────────────────────

/** Error thrown when a ruleset fails to parse or validate. */
export class RulesetParseError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly string[]
  ) {
    super(message);
    this.name = "RulesetParseError";
  }
}
