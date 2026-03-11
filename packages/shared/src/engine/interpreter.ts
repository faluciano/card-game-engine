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
  GameStatus,
  Player,
  PlayerId,
  ResolvedAction,
  VariableDefinition,
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
import { createRng, generateSeed, type SeededRng } from "./prng";
import { isHumanPlayer } from "./role-utils";

/** Maximum number of entries in the action log to prevent unbounded memory growth. */
const MAX_ACTION_LOG_SIZE = 500;

// ─── Variable Manifest Helpers ─────────────────────────────────────

/** Extract initial numeric variables from the unified manifest. */
function getInitialVariables(
  manifest: Readonly<Record<string, VariableDefinition>> | undefined
): Record<string, number> {
  if (!manifest) return {};
  const result: Record<string, number> = {};
  for (const [key, def] of Object.entries(manifest)) {
    if (def.type === "number") result[key] = def.initial;
  }
  return result;
}

/** Extract initial string variables from the unified manifest. */
function getInitialStringVariables(
  manifest: Readonly<Record<string, VariableDefinition>> | undefined
): Record<string, string> {
  if (!manifest) return {};
  const result: Record<string, string> = {};
  for (const [key, def] of Object.entries(manifest)) {
    if (def.type === "string") result[key] = def.initial;
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────

/** Appends an entry to the action log, capping at MAX_ACTION_LOG_SIZE. */
function appendToLog(
  log: readonly ResolvedAction[],
  entry: ResolvedAction
): readonly ResolvedAction[] {
  const newLog = [...log, entry];
  return newLog.length > MAX_ACTION_LOG_SIZE
    ? newLog.slice(-MAX_ACTION_LOG_SIZE)
    : newLog;
}

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
  seed: number = generateSeed()
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
    variables: getInitialVariables(ruleset.variables),
    stringVariables: getInitialStringVariables(ruleset.variables),
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
  seed: number = generateSeed()
): GameReducer {
  // Ensure builtins are registered (idempotent)
  registerAllBuiltins();

  const phaseMachine = new PhaseMachine(ruleset.phases, ruleset.globalTransitions);
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
      actionLog: appendToLog(state.actionLog, { action, timestamp: Date.now(), version: state.version + 1 }),
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
    actionLog: appendToLog(state.actionLog, { action, timestamp: Date.now(), version: state.version + 1 }),
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
    actionLog: appendToLog(state.actionLog, { action, timestamp: Date.now(), version: state.version + 1 }),
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
    actionLog: appendToLog(state.actionLog, {
      action: { kind: "start_game" },
      timestamp: Date.now(),
      version: state.version + 1,
    }),
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

    // ── Auto-end turn via phase expression ──────────────────────────
    newState = maybeAutoEndTurn(newState, state, effects, playerIndex, phaseMachine);

    // Bump version and log
  newState = {
    ...newState,
    version: newState.version + 1,
    actionLog: appendToLog(newState.actionLog, { action, timestamp: Date.now(), version: newState.version + 1 }),
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
  const newToCards = [card, ...toZone.cards];

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

    // ── Auto-end turn via phase expression ──────────────────────────
    newState = maybeAutoEndTurn(newState, state, effects, playerIndex, phaseMachine);
  }

  // Bump version and log
  newState = {
    ...newState,
    version: newState.version + 1,
    actionLog: appendToLog(newState.actionLog, { action, timestamp: Date.now(), version: newState.version + 1 }),
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
    actionLog: appendToLog(state.actionLog, { action, timestamp: Date.now(), version: state.version + 1 }),
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

  const count = state.players.length;
  const nextPlayerIndex =
    ((state.currentPlayerIndex + state.turnDirection) % count + count) % count;

  let newState: CardGameState = {
    ...state,
    currentPlayerIndex: nextPlayerIndex,
    turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
    version: state.version + 1,
    actionLog: appendToLog(state.actionLog, { action, timestamp: Date.now(), version: state.version + 1 }),
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

  // Preserve cumulative_score_* variables across round resets
  const preserved: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.variables)) {
    if (key.startsWith("cumulative_score_")) {
      preserved[key] = value;
    }
  }

  let newState: CardGameState = {
    ...state,
    currentPhase: firstPhase,
    currentPlayerIndex: 0,
    turnNumber: state.turnNumber + 1,
    turnsTakenThisPhase: 0,
    turnDirection: 1,
    scores: {},
    variables: { ...getInitialVariables(state.ruleset.variables), ...preserved },
    stringVariables: getInitialStringVariables(state.ruleset.variables),
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
    if (phase.onEnter && phase.onEnter.length > 0) {
      const ctx: MutableEvalContext = {
        state: current,
        effects: [],
        applyEffectsToState: (s, effs) => applyEffects(s, effs, rng),
      };
      for (const expression of phase.onEnter) {
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
 * Evaluates the auto-end-turn condition for the current phase.
 * If the condition is met and no end_turn effect was already applied,
 * automatically ends the current player's turn.
 */
function maybeAutoEndTurn(
  state: CardGameState,
  previousState: CardGameState,
  effects: readonly EffectDescription[],
  playerIndex: number,
  phaseMachine: PhaseMachine
): CardGameState {
  let phase;
  try {
    phase = phaseMachine.getPhase(state.currentPhase);
  } catch {
    return state;
  }

  const { autoEndTurnCondition } = phase;
  if (
    autoEndTurnCondition &&
    !effects.some((e) => e.kind === "end_turn") &&
    state.currentPlayerIndex === previousState.currentPlayerIndex
  ) {
    const ctx: EvalContext = { state, playerIndex };
    if (evaluateCondition(autoEndTurnCondition, ctx)) {
      // Apply end_turn directly via a mini-draft to avoid exposing StateDraft
      const count = state.players.length;
      const nextIndex = ((state.currentPlayerIndex + state.turnDirection) % count + count) % count;
      return {
        ...state,
        currentPlayerIndex: nextIndex,
        turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
      };
    }
  }
  return state;
}

// ─── StateDraft ────────────────────────────────────────────────────

/**
 * Mutable draft of CardGameState used internally during effect application.
 * Each sub-object (zones, variables, scores, stringVariables) is lazily cloned
 * on first mutation, so effects that don't touch a category pay zero cost.
 * The draft is NOT exposed outside applyEffects — the public API stays immutable.
 */
interface StateDraft {
  // Writable copies of state fields (cloned lazily via ensure* helpers)
  zones: Record<string, ZoneState>;
  scores: Record<string, number>;
  variables: Record<string, number>;
  stringVariables: Record<string, string>;
  // Scalar fields — cheap to copy, always writable on the draft
  currentPlayerIndex: number;
  turnsTakenThisPhase: number;
  turnDirection: 1 | -1;
  turnNumber: number;
  status: GameStatus;
  // Readonly references to fields that effects never modify
  readonly sessionId: CardGameState["sessionId"];
  readonly ruleset: CardGameState["ruleset"];
  readonly players: CardGameState["players"];
  readonly actionLog: CardGameState["actionLog"];
  readonly currentPhase: CardGameState["currentPhase"];
  readonly version: CardGameState["version"];
}

/**
 * Applies a sequence of effect descriptions to produce a new state.
 * Uses a mutable draft internally to avoid N intermediate state copies.
 * Pure from the caller's perspective — does not mutate the input state.
 */
function applyEffects(
  state: CardGameState,
  effects: readonly EffectDescription[],
  rng: SeededRng
): CardGameState {
  if (effects.length === 0) return state;

  // Create a mutable draft — one shallow copy of the top-level state.
  // Sub-objects (zones, variables, scores, stringVariables) are cloned lazily
  // on first mutation via the ensure* helpers.
  const draft: StateDraft = {
    sessionId: state.sessionId,
    ruleset: state.ruleset,
    status: state.status,
    players: state.players,
    zones: state.zones,
    currentPhase: state.currentPhase,
    currentPlayerIndex: state.currentPlayerIndex,
    turnNumber: state.turnNumber,
    turnDirection: state.turnDirection,
    scores: state.scores,
    variables: state.variables,
    stringVariables: state.stringVariables,
    actionLog: state.actionLog,
    turnsTakenThisPhase: state.turnsTakenThisPhase,
    version: state.version,
  };

  // Track which sub-objects have been cloned to avoid double-cloning
  let zonesCloned = false;
  let scoresCloned = false;
  let variablesCloned = false;
  let stringVariablesCloned = false;

  function ensureZones(): Record<string, ZoneState> {
    if (!zonesCloned) {
      draft.zones = { ...state.zones };
      zonesCloned = true;
    }
    return draft.zones;
  }

  function ensureScores(): Record<string, number> {
    if (!scoresCloned) {
      draft.scores = { ...state.scores };
      scoresCloned = true;
    }
    return draft.scores;
  }

  function ensureVariables(): Record<string, number> {
    if (!variablesCloned) {
      draft.variables = { ...state.variables };
      variablesCloned = true;
    }
    return draft.variables;
  }

  function ensureStringVariables(): Record<string, string> {
    if (!stringVariablesCloned) {
      draft.stringVariables = { ...state.stringVariables };
      stringVariablesCloned = true;
    }
    return draft.stringVariables;
  }

  for (const effect of effects) {
    applySingleEffect(draft, effect, rng, ensureZones, ensureScores, ensureVariables, ensureStringVariables);
  }

  return draft as unknown as CardGameState;
}

/**
 * Dispatches a single effect description to the appropriate handler.
 * Mutates the draft in place — returns void.
 */
function applySingleEffect(
  draft: StateDraft,
  effect: EffectDescription,
  rng: SeededRng,
  ensureZones: () => Record<string, ZoneState>,
  ensureScores: () => Record<string, number>,
  ensureVariables: () => Record<string, number>,
  ensureStringVariables: () => Record<string, string>,
): void {
  switch (effect.kind) {
    case "shuffle":
      applyShuffleEffect(draft, effect.params, rng, ensureZones);
      return;
    case "deal":
      applyDealEffect(draft, effect.params, ensureZones);
      return;
    case "draw":
      applyDrawEffect(draft, effect.params, ensureZones);
      return;
    case "set_face_up":
      applySetFaceUpEffect(draft, effect.params, ensureZones);
      return;
    case "reveal_all":
      applyRevealAllEffect(draft, effect.params, ensureZones);
      return;
    case "end_turn":
      applyEndTurnEffect(draft);
      return;
    case "calculate_scores":
      applyCalculateScoresEffect(draft, ensureScores);
      return;
    case "determine_winners":
      applyDetermineWinnersEffect(draft, ensureScores);
      return;
    case "collect_all_to":
      applyCollectAllToEffect(draft, effect.params, ensureZones);
      return;
    case "reset_round":
      applyResetRoundEffect(draft);
      return;
    case "move_top":
      applyMoveTopEffect(draft, effect.params, ensureZones);
      return;
    case "flip_top":
      applyFlipTopEffect(draft, effect.params, ensureZones);
      return;
    case "move_all":
      applyMoveAllEffect(draft, effect.params, ensureZones);
      return;
    case "reverse_turn_order":
      applyReverseTurnOrderEffect(draft);
      return;
    case "skip_next_player":
      applySkipNextPlayerEffect(draft);
      return;
    case "set_next_player":
      applySetNextPlayerEffect(draft, effect.params);
      return;
    case "set_var":
      applySetVarEffect(draft, effect.params, ensureVariables);
      return;
    case "set_str_var":
      applySetStrVarEffect(draft, effect.params, ensureStringVariables);
      return;
    case "inc_var":
      applyIncVarEffect(draft, effect.params, ensureVariables);
      return;
    case "collect_trick":
      applyCollectTrickEffect(draft, effect.params, ensureZones);
      return;
    case "set_lead_player":
      applySetLeadPlayerEffect(draft, effect.params, ensureVariables);
      return;
    case "end_game":
      applyEndGameEffect(draft);
      return;
    case "accumulate_scores":
      applyAccumulateScoresEffect(draft, ensureVariables);
      return;
    default:
      // Unknown effects are ignored — forward compatible
      return;
  }
}

// ─── Effect Implementations ────────────────────────────────────────

/**
 * Shuffles all cards in a zone using the seeded RNG.
 */
function applyShuffleEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  rng: SeededRng,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const zoneName = params.zone as string;
  const zone = draft.zones[zoneName];
  if (!zone) return;

  const zones = ensureZones();
  const shuffled = rng.shuffle(zone.cards);
  zones[zoneName] = { ...zone, cards: shuffled };
}

/**
 * Deals cards from a source zone to all per-player target zones.
 * For each player zone matching the template (e.g., "hand:0", "hand:1"),
 * moves `count` cards from the source.
 * Also handles non-per-player zones (e.g., "dealer_hand").
 */
function applyDealEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const from = params.from as string;
  const to = params.to as string;
  const count = params.count as number;

  const fromZone = draft.zones[from];
  if (!fromZone) return;

  const zones = ensureZones();
  let fromCards = [...fromZone.cards];

  // Find all per-player variants of the "to" zone, or the exact zone
  const targetZones = Object.keys(zones).filter(
    (name) => name === to || name.startsWith(`${to}:`)
  );

  // If no matching zones, return unchanged
  if (targetZones.length === 0) return;

  for (const targetZone of targetZones) {
    const cardsToMove = fromCards.splice(0, count);
    const existing = zones[targetZone]!;
    zones[targetZone] = {
      ...existing,
      cards: [...existing.cards, ...cardsToMove],
    };
  }

  zones[from] = { ...fromZone, cards: fromCards };
}

/**
 * Draws cards from a source zone to a target zone for the current player.
 * Resolves per-player zone names if needed.
 */
function applyDrawEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const from = params.from as string;
  const to = params.to as string;
  const count = params.count as number;

  const fromZone = draft.zones[from];
  if (!fromZone) return;

  // Resolve target zone — might be per-player
  let targetZone = to;
  if (!(targetZone in draft.zones)) {
    const perPlayerName = `${to}:${draft.currentPlayerIndex}`;
    if (perPlayerName in draft.zones) {
      targetZone = perPlayerName;
    }
  }

  const target = draft.zones[targetZone];
  if (!target) return;

  const zones = ensureZones();
  const fromCards = [...fromZone.cards];
  const drawnCards = fromCards.splice(0, count);

  zones[from] = { ...fromZone, cards: fromCards };
  zones[targetZone] = { ...target, cards: [...target.cards, ...drawnCards] };
}

/**
 * Sets a specific card's faceUp property in a zone.
 */
function applySetFaceUpEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const zoneName = params.zone as string;
  const cardIndex = params.cardIndex as number;
  const faceUp = params.faceUp as boolean;

  const zone = draft.zones[zoneName];
  if (!zone || cardIndex < 0 || cardIndex >= zone.cards.length) return;

  const zones = ensureZones();
  const updatedCards = zone.cards.map((card, i) =>
    i === cardIndex ? { ...card, faceUp } : card
  );

  zones[zoneName] = { ...zone, cards: updatedCards };
}

/**
 * Sets all cards in a zone to faceUp: true.
 */
function applyRevealAllEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const zoneName = params.zone as string;
  const zone = draft.zones[zoneName];
  if (!zone) return;

  const zones = ensureZones();
  const revealedCards = zone.cards.map((card) => ({ ...card, faceUp: true }));

  zones[zoneName] = { ...zone, cards: revealedCards };
}

/**
 * Advances currentPlayerIndex to the next human player. Wraps around.
 */
function applyEndTurnEffect(draft: StateDraft): void {
  const count = draft.players.length;
  const nextIndex = ((draft.currentPlayerIndex + draft.turnDirection) % count + count) % count;

  draft.currentPlayerIndex = nextIndex;
  draft.turnsTakenThisPhase = draft.turnsTakenThisPhase + 1;
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
function applyCalculateScoresEffect(
  draft: StateDraft,
  ensureScores: () => Record<string, number>,
): void {
  const { roles, scoring } = draft.ruleset;
  const scores = ensureScores();

  for (const role of roles) {
    if (role.isHuman) {
      // Score each human player
      for (let i = 0; i < draft.players.length; i++) {
        const player = draft.players[i]!;
        if (!isHumanPlayer(player, roles)) continue;

        const ctx: EvalContext = { state: draft as unknown as CardGameState, playerIndex: i };
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
      const zoneMap = buildNpcZoneMap(role.name, draft.zones);
      const ctx: EvalContext = {
        state: draft as unknown as CardGameState,
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
}

/**
 * Determines round results by evaluating bust/win/tie conditions per player.
 * Evaluation order: bust → win → tie → loss (default).
 * Results stored as "result:N" where 1=win, 0=tie, -1=loss.
 */
function applyDetermineWinnersEffect(
  draft: StateDraft,
  ensureScores: () => Record<string, number>,
): void {
  const { scoring, roles } = draft.ruleset;
  const scores = ensureScores();

  for (let i = 0; i < draft.players.length; i++) {
    const player = draft.players[i]!;
    if (!isHumanPlayer(player, roles)) continue;

    const myScore = scores[`player_score:${i}`] ?? 0;
    const bindings: Record<string, EvalResult> = {
      my_score: { kind: "number", value: myScore },
    };
    const ctx: EvalContext = { state: draft as unknown as CardGameState, playerIndex: i, bindings };

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
}

/**
 * Collects all cards from all zones into the specified target zone.
 */
function applyCollectAllToEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const targetName = params.zone as string;
  const zones = ensureZones();
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
}

/**
 * Resets the round: clears scores, resets player index, increments turn.
 */
function applyResetRoundEffect(draft: StateDraft): void {
  // Preserve cumulative_score_* variables across round resets
  const preserved: Record<string, number> = {};
  for (const [key, value] of Object.entries(draft.variables)) {
    if (key.startsWith("cumulative_score_")) {
      preserved[key] = value;
    }
  }

  draft.currentPlayerIndex = 0;
  draft.turnNumber = draft.turnNumber + 1;
  draft.turnsTakenThisPhase = 0;
  draft.turnDirection = 1;
  draft.scores = {};
  draft.variables = { ...getInitialVariables(draft.ruleset.variables), ...preserved };
  draft.stringVariables = getInitialStringVariables(draft.ruleset.variables);
}

/**
 * Sets a custom variable to a specific value.
 */
function applySetVarEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureVariables: () => Record<string, number>,
): void {
  const name = params.name as string;
  const value = params.value as number;
  const variables = ensureVariables();
  variables[name] = value;
}

/**
 * Sets a custom string variable to a specific value.
 */
function applySetStrVarEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureStringVariables: () => Record<string, string>,
): void {
  const name = params.name as string;
  const value = params.value as string;
  const stringVars = ensureStringVariables();
  stringVars[name] = value;
}

/**
 * Increments a custom variable by an amount.
 * If the variable doesn't exist yet, treats it as starting from 0.
 */
function applyIncVarEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureVariables: () => Record<string, number>,
): void {
  const name = params.name as string;
  const amount = params.amount as number;
  const variables = ensureVariables();
  variables[name] = (variables[name] ?? 0) + amount;
}

/**
 * Moves the top N cards from one zone to another.
 * If the source zone has fewer cards than `count`, moves all available.
 * Preserves card state (faceUp, etc.).
 */
function applyMoveTopEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const fromName = params.from as string;
  const toName = params.to as string;
  const count = params.count as number;

  const fromZone = draft.zones[fromName];
  const toZone = draft.zones[toName];
  if (!fromZone || !toZone) return;

  const zones = ensureZones();
  const fromCards = [...fromZone.cards];
  const movedCards = fromCards.splice(0, count);

  zones[fromName] = { ...fromZone, cards: fromCards };
  zones[toName] = { ...toZone, cards: [...toZone.cards, ...movedCards] };
}

/**
 * Flips the top N cards in a zone to faceUp = true.
 * If the zone has fewer cards than `count`, flips all.
 */
function applyFlipTopEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const zoneName = params.zone as string;
  const count = params.count as number;

  const zone = draft.zones[zoneName];
  if (!zone) return;

  const zones = ensureZones();
  const updatedCards = zone.cards.map((card, i) =>
    i < count ? { ...card, faceUp: true } : card
  );

  zones[zoneName] = { ...zone, cards: updatedCards };
}

/**
 * Moves ALL cards from one zone to another.
 * Cards retain their faceUp state.
 */
function applyMoveAllEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const fromName = params.from as string;
  const toName = params.to as string;

  const fromZone = draft.zones[fromName];
  const toZone = draft.zones[toName];
  if (!fromZone || !toZone) return;

  const zones = ensureZones();
  zones[fromName] = { ...fromZone, cards: [] };
  zones[toName] = { ...toZone, cards: [...toZone.cards, ...fromZone.cards] };
}

/**
 * Reverses the turn direction. Clockwise becomes counterclockwise and vice versa.
 */
function applyReverseTurnOrderEffect(draft: StateDraft): void {
  draft.turnDirection = draft.turnDirection === 1 ? -1 : 1;
}

/**
 * Skips the next player by advancing the current player index by one extra step
 * in the current turn direction.
 */
function applySkipNextPlayerEffect(draft: StateDraft): void {
  const count = draft.players.length;
  const nextIndex = ((draft.currentPlayerIndex + draft.turnDirection) % count + count) % count;
  draft.currentPlayerIndex = nextIndex;
}

/**
 * Sets the current player to a specific index.
 */
function applySetNextPlayerEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
): void {
  const playerIndex = params.playerIndex as number;
  if (playerIndex < 0 || playerIndex >= draft.players.length) return;
  draft.currentPlayerIndex = playerIndex;
}

/**
 * Collects all cards from every `{prefix}:{N}` zone into a target zone.
 * Cards are set face-down (they go into a won pile, not displayed).
 * Source zones are emptied.
 */
function applyCollectTrickEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureZones: () => Record<string, ZoneState>,
): void {
  const zonePrefix = params.zonePrefix as string;
  const targetZoneName = params.targetZone as string;
  const playerCount = draft.players.length;

  const zones = ensureZones();
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
}

/**
 * Sets `variables.lead_player` to the given player index AND sets
 * `currentPlayerIndex` to that player, so the trick winner leads next.
 */
function applySetLeadPlayerEffect(
  draft: StateDraft,
  params: Record<string, unknown>,
  ensureVariables: () => Record<string, number>,
): void {
  const playerIndex = params.playerIndex as number;
  const variables = ensureVariables();
  variables.lead_player = playerIndex;
  draft.currentPlayerIndex = playerIndex;
}

/**
 * Transitions the game status to `{ kind: "finished" }`.
 * The winnerId is derived from scores: the player with `result:N === 1`.
 * If no clear winner, winnerId is null.
 */
function applyEndGameEffect(draft: StateDraft): void {
  let winnerId: PlayerId | null = null;

  for (let i = 0; i < draft.players.length; i++) {
    if (draft.scores[`result:${i}`] === 1) {
      winnerId = draft.players[i]!.id;
      break;
    }
  }

  draft.status = {
    kind: "finished",
    finishedAt: Date.now(),
    winnerId,
  };
}

/**
 * Accumulates each human player's round score into their cumulative score variable.
 * Reads scores["player_score:{i}"] and adds to variables["cumulative_score_{i}"].
 */
function applyAccumulateScoresEffect(
  draft: StateDraft,
  ensureVariables: () => Record<string, number>,
): void {
  const variables = ensureVariables();
  const { roles } = draft.ruleset;

  for (let i = 0; i < draft.players.length; i++) {
    if (!isHumanPlayer(draft.players[i]!, roles)) continue;
    const roundScore = draft.scores[`player_score:${i}`] ?? 0;
    const key = `cumulative_score_${i}`;
    variables[key] = (variables[key] ?? 0) + roundScore;
  }
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
          phaseOverrides: zoneConfig.phaseOverrides,
        };
        zones[name] = { definition, cards: [] };
      }
    } else {
      const definition: ZoneDefinition = {
        name: zoneConfig.name,
        visibility: zoneConfig.visibility,
        owners: zoneConfig.owners,
        maxCards: zoneConfig.maxCards,
        phaseOverrides: zoneConfig.phaseOverrides,
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
