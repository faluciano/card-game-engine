// ─── Ruleset Interpreter ───────────────────────────────────────────
// Transforms a static CardGameRuleset into runtime constructs:
// an engine (explicit apply + reducer), an initial state factory, and a
// phase machine.
//
// Determinism: the engine holds no mutable state. The PRNG is rebuilt from
// `state.rngState` on every call and the advanced state is written back, and
// wall-clock reads go through an injectable `now`, so `(state, action)` always
// yields the same result regardless of which engine instance applied it.

import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
  CardInstanceId,
  Card,
  GameReducer,
  GameSessionId,
  GameStatus,
  PhaseDefinition,
  Player,
  PlayerId,
  ResolvedAction,
  VariableDefinition,
  ZoneDefinition,
  ZoneState,
} from "../types/index";
import type {
  EffectDescription,
  EffectKind,
  IncVarParams,
  MoveAllParams,
  MoveRankParams,
  PlayerIndexParams,
  SetFaceUpParams,
  SetStrVarParams,
  SetVarParams,
  TransferParams,
  CollectTrickParams,
  FlipTopParams,
  ZoneParams,
} from "./effects";
import { getPresetDeck, type CardTemplate } from "../deck/presets";
import { PhaseMachine } from "./phase-machine";
import { registerAllBuiltins, type MutableEvalContext } from "./builtins";
import {
  evaluateCondition,
  evaluateExpression,
  type EvalContext,
  type EvalResult,
} from "./expression-evaluator";
import { validateAction, executePhaseAction } from "./action-validator";
import { createRng, generateSeed, type SeededRng } from "./prng";
import { isHumanPlayer } from "./role-utils";
import { EffectError, missingZoneError } from "./effects";
import { nextPlayerIndex } from "./player-order";

/** Maximum number of entries in the action log to prevent unbounded memory growth. */
const MAX_ACTION_LOG_SIZE = 500;

// ─── Public Types ──────────────────────────────────────────────────

/** Injectable dependencies for the engine. Everything defaults to production values. */
export interface ReducerOptions {
  /** Clock used for action-log timestamps and status transitions. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Explicit outcome of applying an action. A rejection carries the reason so
 * callers never have to infer it from referential equality or re-validate.
 */
export type ApplyResult =
  | { readonly kind: "applied"; readonly state: CardGameState }
  | { readonly kind: "rejected"; readonly reason: string };

/** A ruleset bound to its runtime machinery. */
export interface GameEngine {
  readonly ruleset: CardGameRuleset;
  /** Phase machine for this ruleset — share it with the action validators. */
  readonly phaseMachine: PhaseMachine;
  /** Applies an action, reporting rejections explicitly. */
  readonly apply: (state: CardGameState, action: CardGameAction) => ApplyResult;
  /** Reducer view of `apply`: a rejected action returns the input state unchanged. */
  readonly reduce: GameReducer;
}

// ─── Runtime ───────────────────────────────────────────────────────

/** Per-call runtime handed to every handler: phase machine, resumed PRNG, clock. */
interface Runtime {
  readonly phaseMachine: PhaseMachine;
  readonly rng: SeededRng;
  readonly now: () => number;
}

function applied(state: CardGameState): ApplyResult {
  return { kind: "applied", state };
}

function rejected(reason: string): ApplyResult {
  return { kind: "rejected", reason };
}

// ─── Variable Manifest Helpers ─────────────────────────────────────

/** Extract initial numeric variables from the unified manifest. */
function getInitialVariables(
  manifest: Readonly<Record<string, VariableDefinition>> | undefined,
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
  manifest: Readonly<Record<string, VariableDefinition>> | undefined,
): Record<string, string> {
  if (!manifest) return {};
  const result: Record<string, string> = {};
  for (const [key, def] of Object.entries(manifest)) {
    if (def.type === "string") result[key] = def.initial;
  }
  return result;
}

// ─── State Helpers ─────────────────────────────────────────────────

/** Appends an entry to the action log, capping at MAX_ACTION_LOG_SIZE. */
function appendToLog(
  log: readonly ResolvedAction[],
  entry: ResolvedAction,
): readonly ResolvedAction[] {
  const newLog = [...log, entry];
  return newLog.length > MAX_ACTION_LOG_SIZE ? newLog.slice(-MAX_ACTION_LOG_SIZE) : newLog;
}

/** Bumps the version and records `action` in the log — the final step of every player action. */
function commit(state: CardGameState, action: CardGameAction, now: () => number): CardGameState {
  const version = state.version + 1;
  return {
    ...state,
    version,
    actionLog: appendToLog(state.actionLog, { action, timestamp: now(), version }),
  };
}

/** Moves to `phaseName`, resetting the per-phase turn counter and bumping the version. */
function enterPhase(state: CardGameState, phaseName: string): CardGameState {
  return { ...state, currentPhase: phaseName, turnsTakenThisPhase: 0, version: state.version + 1 };
}

/** The fields a round reset rewrites; shared by the `reset_round` action and effect. */
type RoundResetFields = Pick<
  CardGameState,
  | "currentPlayerIndex"
  | "turnNumber"
  | "turnsTakenThisPhase"
  | "turnDirection"
  | "scores"
  | "variables"
  | "stringVariables"
>;

/**
 * Computes a fresh round: player index and direction reset, turn number
 * bumped, scores cleared, variables back to their initial values — except
 * `cumulative_score_*`, which persist across rounds.
 */
function resetRoundFields(
  ruleset: CardGameRuleset,
  variables: Readonly<Record<string, number>>,
  turnNumber: number,
): RoundResetFields {
  const preserved: Record<string, number> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (key.startsWith("cumulative_score_")) preserved[key] = value;
  }
  return {
    currentPlayerIndex: 0,
    turnNumber: turnNumber + 1,
    turnsTakenThisPhase: 0,
    turnDirection: 1,
    scores: {},
    variables: { ...getInitialVariables(ruleset.variables), ...preserved },
    stringVariables: getInitialStringVariables(ruleset.variables),
  };
}

// ─── createInitialState ────────────────────────────────────────────

/**
 * Creates the initial game state for a ruleset with the given players.
 * Sets up the deck and zones per the ruleset, placing all cards in the
 * draw pile. Does NOT shuffle or deal — that happens when start_game
 * triggers the first automatic phase.
 *
 * The seed drives card instance IDs here and, via `rngState`, every
 * shuffle for the rest of the game.
 */
export function createInitialState(
  ruleset: CardGameRuleset,
  sessionId: GameSessionId,
  players: readonly Player[],
  seed: number = generateSeed(),
): CardGameState {
  if (players.length < ruleset.meta.players.min) {
    throw new RangeError(
      `Need at least ${ruleset.meta.players.min} players, got ${players.length}`,
    );
  }
  if (players.length > ruleset.meta.players.max) {
    throw new RangeError(
      `At most ${ruleset.meta.players.max} players allowed, got ${players.length}`,
    );
  }

  const rng = createRng(seed);

  // Build deck from preset templates or custom card definitions
  const templates =
    ruleset.deck.preset === "custom" ? ruleset.deck.cards : getPresetDeck(ruleset.deck.preset);
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
    // Gameplay randomness starts from the seed itself, independent of the
    // card-ID stream above — the same sequence a reducer seeded with `seed`
    // produced before RNG state moved into CardGameState, so seeded replays
    // and fixtures stay valid.
    rngState: seed >>> 0,
  };
}

// ─── createEngine / createReducer ──────────────────────────────────

/**
 * Binds a ruleset to its phase machine and returns an engine whose `apply`
 * reports rejections explicitly. One engine can safely serve any number of
 * concurrent games: all per-game state lives in `CardGameState`.
 */
export function createEngine(ruleset: CardGameRuleset, options: ReducerOptions = {}): GameEngine {
  // Ensure builtins are registered (idempotent)
  registerAllBuiltins();

  const phaseMachine = new PhaseMachine(ruleset.phases, ruleset.globalTransitions);
  const now = options.now ?? Date.now;

  const apply = (state: CardGameState, action: CardGameAction): ApplyResult => {
    const rng = createRng(state.rngState);
    const result = dispatch(state, action, { phaseMachine, rng, now });
    if (result.kind === "rejected") return result;
    return applied({ ...result.state, rngState: rng.state });
  };

  const reduce: GameReducer = (state, action) => {
    const result = apply(state, action);
    return result.kind === "applied" ? result.state : state;
  };

  return { ruleset, phaseMachine, apply, reduce };
}

/**
 * Creates a pure reducer function bound to a specific ruleset.
 * Rejected actions return the input state unchanged; use
 * {@link createEngine} when the rejection reason is needed.
 */
export function createReducer(ruleset: CardGameRuleset, options?: ReducerOptions): GameReducer {
  return createEngine(ruleset, options).reduce;
}

function dispatch(state: CardGameState, action: CardGameAction, rt: Runtime): ApplyResult {
  switch (action.kind) {
    case "join":
      return handleJoin(state, action, rt);
    case "leave":
      return handleLeave(state, action, rt);
    case "start_game":
      return handleStartGame(state, rt);
    case "declare":
      return handleDeclare(state, action, rt);
    case "play_card":
      return handlePlayCard(state, action, rt);
    case "draw_card":
      return handleDrawCard(state, action, rt);
    case "end_turn":
      return handleEndTurn(state, action, rt);
    case "advance_phase":
      return handleAdvancePhase(state, rt);
    case "step_phase":
      return handleStepPhase(state, rt);
    case "reset_round":
      return handleResetRound(state, rt);
  }
}

// ─── Action Handlers ───────────────────────────────────────────────

/**
 * Handles a "join" action — adds a player or reconnects an existing one.
 * Only legal while waiting for players: zones are laid out per player at
 * creation time, so a mid-game joiner would have nowhere to hold cards.
 */
function handleJoin(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "join" }>,
  rt: Runtime,
): ApplyResult {
  if (state.status.kind !== "waiting_for_players") {
    return rejected(`Cannot join: game status is "${state.status.kind}"`);
  }

  const existingIndex = state.players.findIndex((p) => p.id === action.playerId);

  if (existingIndex !== -1) {
    // Reconnect existing player
    const players = state.players.map((p, i) =>
      i === existingIndex ? { ...p, connected: true } : p,
    );
    return applied(commit({ ...state, players }, action, rt.now));
  }

  if (state.players.length >= state.ruleset.meta.players.max) {
    return rejected(`Cannot join: game is full (${state.ruleset.meta.players.max} players)`);
  }

  const newPlayer: Player = {
    id: action.playerId,
    name: action.name,
    role: "player",
    connected: true,
  };
  return applied(commit({ ...state, players: [...state.players, newPlayer] }, action, rt.now));
}

/**
 * Handles a "leave" action — marks a player as disconnected.
 * Does not remove the player (CouchKit handles reconnection).
 */
function handleLeave(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "leave" }>,
  rt: Runtime,
): ApplyResult {
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIndex === -1) return rejected(`Player not found: ${action.playerId}`);

  const players = state.players.map((p, i) => (i === playerIndex ? { ...p, connected: false } : p));
  return applied(commit({ ...state, players }, action, rt.now));
}

/**
 * Handles a "start_game" action — transitions from waiting to in_progress,
 * then runs automatic phases (e.g., deal).
 */
function handleStartGame(state: CardGameState, rt: Runtime): ApplyResult {
  if (state.status.kind !== "waiting_for_players") {
    return rejected(`Cannot start: game status is "${state.status.kind}"`);
  }

  const { min } = state.ruleset.meta.players;
  if (state.players.length < min) {
    return rejected(`Cannot start: need at least ${min} players, have ${state.players.length}`);
  }

  const started = commit(
    { ...state, status: { kind: "in_progress", startedAt: rt.now() } },
    { kind: "start_game" },
    rt.now,
  );

  // Run automatic phases (e.g., deal phase in blackjack)
  return applied(runAutomaticPhases(started, rt));
}

/**
 * Handles a "declare" action — validates, executes effects, checks transitions.
 */
function handleDeclare(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "declare" }>,
  rt: Runtime,
): ApplyResult {
  const validation = validateAction(state, action, rt.phaseMachine);
  if (!validation.valid) return rejected(validation.reason);

  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);

  const effects = executePhaseAction(
    state,
    action.declaration,
    playerIndex,
    rt.phaseMachine,
    action.params ?? {},
  );

  let newState = applyEffects(state, effects, rt);
  newState = maybeAutoEndTurn(newState, state, effects, playerIndex, rt.phaseMachine);
  newState = commit(newState, action, rt.now);

  return applied(checkTransitionsAndRunAuto(newState, rt));
}

/**
 * Handles a "play_card" action — moves a specific card between zones,
 * then executes any "play_card" phase action effects, checks auto-end-turn,
 * and runs transitions.
 */
function handlePlayCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "play_card" }>,
  rt: Runtime,
): ApplyResult {
  const validation = validateAction(state, action, rt.phaseMachine);
  if (!validation.valid) return rejected(validation.reason);

  // ── Move the card between zones ────────────────────────────────
  const zones = { ...state.zones };
  const fromZone = zones[action.fromZone]!;
  const toZone = zones[action.toZone]!;

  const cardIndex = fromZone.cards.findIndex((c) => c.id === action.cardId);
  if (cardIndex === -1) {
    return rejected(`Card ${action.cardId} is not in zone "${action.fromZone}"`);
  }

  const card = fromZone.cards[cardIndex]!;
  zones[action.fromZone] = { ...fromZone, cards: fromZone.cards.filter((_, i) => i !== cardIndex) };
  zones[action.toZone] = { ...toZone, cards: [card, ...toZone.cards] };

  let newState: CardGameState = { ...state, zones };

  // ── Execute phase action effects (if "play_card" action exists) ─
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  const playCardAction = findPhase(rt.phaseMachine, state.currentPhase)?.actions.find(
    (a) => a.name === "play_card",
  );

  if (playCardAction) {
    const effects = executePhaseAction(newState, "play_card", playerIndex, rt.phaseMachine);
    newState = applyEffects(newState, effects, rt);
    newState = maybeAutoEndTurn(newState, state, effects, playerIndex, rt.phaseMachine);
  }

  newState = commit(newState, action, rt.now);

  // Check transitions after the action
  if (playCardAction) {
    newState = checkTransitionsAndRunAuto(newState, rt);
  }

  return applied(newState);
}

/**
 * Handles a "draw_card" action — moves N cards from one zone to another.
 */
function handleDrawCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "draw_card" }>,
  rt: Runtime,
): ApplyResult {
  const validation = validateAction(state, action, rt.phaseMachine);
  if (!validation.valid) return rejected(validation.reason);

  const zones = { ...state.zones };
  const fromZone = zones[action.fromZone]!;
  const toZone = zones[action.toZone]!;

  const fromCards = [...fromZone.cards];
  const drawnCards = fromCards.splice(0, action.count);

  zones[action.fromZone] = { ...fromZone, cards: fromCards };
  zones[action.toZone] = { ...toZone, cards: [...toZone.cards, ...drawnCards] };

  return applied(commit({ ...state, zones }, action, rt.now));
}

/**
 * Handles an "end_turn" action — advances to next player, checks transitions.
 */
function handleEndTurn(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "end_turn" }>,
  rt: Runtime,
): ApplyResult {
  const validation = validateAction(state, action, rt.phaseMachine);
  if (!validation.valid) return rejected(validation.reason);

  const newState = commit(
    {
      ...state,
      currentPlayerIndex: nextPlayerIndex(
        state.currentPlayerIndex,
        state.turnDirection,
        state.players.length,
      ),
      turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
    },
    action,
    rt.now,
  );

  // Check transitions (e.g., all_players_done triggers phase change)
  return applied(checkTransitionsAndRunAuto(newState, rt));
}

/**
 * Handles an "advance_phase" internal action.
 */
function handleAdvancePhase(state: CardGameState, rt: Runtime): ApplyResult {
  const next = followTransition(state, rt);
  if (!next) return rejected(`No transition available from phase "${state.currentPhase}"`);
  return applied(next);
}

/**
 * Handles a "step_phase" internal action — advances a *paced* automatic
 * phase by one step. Runs the current phase's `onStep` hook exactly once
 * (with effect flushing so successive steps see prior mutations), then
 * evaluates transitions. If a transition fires, the phase advances and any
 * following automatic phases run to completion.
 *
 * Used by the host to pace sequences (e.g., a dealer drawing one card at a
 * time) without blocking the pure reducer. Rejected for non-automatic
 * phases or phases without an `onStep` hook.
 */
function handleStepPhase(state: CardGameState, rt: Runtime): ApplyResult {
  if (!rt.phaseMachine.isAutomaticPhase(state.currentPhase)) {
    return rejected(`Phase "${state.currentPhase}" is not automatic`);
  }

  const phase = rt.phaseMachine.getPhase(state.currentPhase);
  if (!phase.onStep || phase.onStep.length === 0) {
    return rejected(`Phase "${state.currentPhase}" has no onStep hook`);
  }

  const stepped = runHook(state, phase.onStep, rt);

  const next = followTransition(stepped, rt);
  return applied(next ?? { ...stepped, version: stepped.version + 1 });
}

/**
 * Handles a "reset_round" internal action. Mid-game it restarts the round
 * from the first phase; once the game has finished it starts a new game.
 */
function handleResetRound(state: CardGameState, rt: Runtime): ApplyResult {
  if (state.status.kind === "finished") return applied(startNewGame(state, rt));

  const newState: CardGameState = {
    ...state,
    ...resetRoundFields(state.ruleset, state.variables, state.turnNumber),
    currentPhase: state.ruleset.phases[0]!.name,
    version: state.version + 1,
  };
  return applied(runAutomaticPhases(newState, rt));
}

/**
 * Starts a new game with the same players after the previous one finished:
 * every card goes back to the deck face-down, all variables (including
 * `cumulative_score_*`) return to their initial values, and the first
 * automatic phases run again (shuffle, deal).
 */
function startNewGame(state: CardGameState, rt: Runtime): CardGameState {
  const allCards = Object.values(state.zones).flatMap((zone) =>
    zone.cards.map((card) => ({ ...card, faceUp: false })),
  );
  const newState: CardGameState = {
    ...state,
    status: { kind: "in_progress", startedAt: rt.now() },
    zones: initializeZones(state.ruleset, state.players, allCards),
    currentPhase: state.ruleset.phases[0]!.name,
    currentPlayerIndex: 0,
    turnNumber: 1,
    turnsTakenThisPhase: 0,
    turnDirection: 1,
    scores: {},
    variables: getInitialVariables(state.ruleset.variables),
    stringVariables: getInitialStringVariables(state.ruleset.variables),
    version: state.version + 1,
  };
  return runAutomaticPhases(newState, rt);
}

// ─── Automatic Phase Execution ─────────────────────────────────────

/** Safety limit for automatic phase loops to prevent infinite loops. */
const MAX_PHASE_ITERATIONS = 50;

/** Looks up a phase, returning undefined (instead of throwing) when the name is unknown. */
function findPhase(phaseMachine: PhaseMachine, name: string): PhaseDefinition | undefined {
  try {
    return phaseMachine.getPhase(name);
  } catch {
    return undefined;
  }
}

/**
 * Evaluates a phase hook (`onEnter` / `onStep`) with an effect-flushing
 * context, so `while()` loops see effects applied between iterations
 * (e.g., drawn cards), then applies any remaining unflushed effects.
 */
function runHook(state: CardGameState, expressions: readonly string[], rt: Runtime): CardGameState {
  const ctx: MutableEvalContext = {
    state,
    effects: [],
    applyEffectsToState: (s, effs) => applyEffects(s, effs, rt),
  };
  for (const expression of expressions) {
    evaluateExpression(expression, ctx);
  }
  return applyEffects(ctx.state, ctx.effects, rt);
}

/**
 * Runs automatic phases in sequence until a non-automatic phase is reached
 * or no transition is available.
 */
function runAutomaticPhases(state: CardGameState, rt: Runtime): CardGameState {
  let current = state;

  for (let iterations = 0; iterations < MAX_PHASE_ITERATIONS; iterations++) {
    if (!rt.phaseMachine.isAutomaticPhase(current.currentPhase)) break;

    const phase = rt.phaseMachine.getPhase(current.currentPhase);
    if (phase.onEnter && phase.onEnter.length > 0) {
      current = runHook(current, phase.onEnter, rt);
    }

    const transition = rt.phaseMachine.evaluateTransitions(current);
    if (transition.kind === "stay") break;

    current = enterPhase(current, transition.nextPhase);
  }

  return current;
}

/**
 * If a transition fires from the current phase, enters the next phase and
 * runs any automatic phases that follow. Returns null when staying put.
 */
function followTransition(state: CardGameState, rt: Runtime): CardGameState | null {
  const transition = rt.phaseMachine.evaluateTransitions(state);
  if (transition.kind === "stay") return null;
  return runAutomaticPhases(enterPhase(state, transition.nextPhase), rt);
}

/** {@link followTransition}, returning the input state unchanged when staying. */
function checkTransitionsAndRunAuto(state: CardGameState, rt: Runtime): CardGameState {
  return followTransition(state, rt) ?? state;
}

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
  phaseMachine: PhaseMachine,
): CardGameState {
  const phase = findPhase(phaseMachine, state.currentPhase);
  if (!phase) return state;

  const { autoEndTurnCondition } = phase;
  if (
    autoEndTurnCondition &&
    !effects.some((e) => e.kind === "end_turn") &&
    state.currentPlayerIndex === previousState.currentPlayerIndex
  ) {
    const ctx: EvalContext = { state, playerIndex };
    if (evaluateCondition(autoEndTurnCondition, ctx)) {
      return {
        ...state,
        currentPlayerIndex: nextPlayerIndex(
          state.currentPlayerIndex,
          state.turnDirection,
          state.players.length,
        ),
        turnsTakenThisPhase: state.turnsTakenThisPhase + 1,
      };
    }
  }
  return state;
}

// ─── StateDraft ────────────────────────────────────────────────────

/**
 * Mutable draft of CardGameState used internally during effect application.
 * Structurally a CardGameState (so evaluators can read it directly), with the
 * fields effects modify made writable. Sub-objects (zones, variables, scores,
 * stringVariables) are cloned lazily on first mutation via {@link Draft}.
 */
interface StateDraft
  extends Omit<
    CardGameState,
    | "zones"
    | "scores"
    | "variables"
    | "stringVariables"
    | "currentPlayerIndex"
    | "turnsTakenThisPhase"
    | "turnDirection"
    | "turnNumber"
    | "status"
  > {
  zones: Record<string, ZoneState>;
  scores: Record<string, number>;
  variables: Record<string, number>;
  stringVariables: Record<string, string>;
  currentPlayerIndex: number;
  turnsTakenThisPhase: number;
  turnDirection: 1 | -1;
  turnNumber: number;
  status: GameStatus;
}

/** A state draft plus copy-on-write accessors for its record fields. */
interface Draft {
  readonly state: StateDraft;
  /** Writable zones map, cloned from the source state on first call. */
  zones(): Record<string, ZoneState>;
  scores(): Record<string, number>;
  variables(): Record<string, number>;
  stringVariables(): Record<string, string>;
}

function createDraft(source: CardGameState): Draft {
  const state: StateDraft = { ...source };
  let zonesCloned = false;
  let scoresCloned = false;
  let variablesCloned = false;
  let stringVariablesCloned = false;

  return {
    state,
    zones() {
      if (!zonesCloned) {
        state.zones = { ...source.zones };
        zonesCloned = true;
      }
      return state.zones;
    },
    scores() {
      if (!scoresCloned) {
        state.scores = { ...source.scores };
        scoresCloned = true;
      }
      return state.scores;
    },
    variables() {
      if (!variablesCloned) {
        state.variables = { ...source.variables };
        variablesCloned = true;
      }
      return state.variables;
    },
    stringVariables() {
      if (!stringVariablesCloned) {
        state.stringVariables = { ...source.stringVariables };
        stringVariablesCloned = true;
      }
      return state.stringVariables;
    },
  };
}

/**
 * Applies a sequence of effect descriptions to produce a new state.
 * Uses a mutable draft internally to avoid N intermediate state copies.
 * Pure from the caller's perspective — does not mutate the input state.
 */
function applyEffects(
  state: CardGameState,
  effects: readonly EffectDescription[],
  rt: Runtime,
): CardGameState {
  if (effects.length === 0) return state;

  const draft = createDraft(state);
  for (const effect of effects) {
    applySingleEffect(draft, effect, rt);
  }
  return draft.state;
}

function assertNever(value: never): never {
  throw new Error(`Unknown effect: ${JSON.stringify(value)}`);
}

/**
 * Dispatches a single effect description to the appropriate handler.
 * Mutates the draft in place. Exhaustive: an effect kind without a case
 * is a compile error, and an unknown kind at runtime throws.
 */
function applySingleEffect(draft: Draft, effect: EffectDescription, rt: Runtime): void {
  switch (effect.kind) {
    case "shuffle":
      applyShuffleEffect(draft, effect.params, rt.rng);
      return;
    case "deal":
      applyDealEffect(draft, effect.params);
      return;
    case "draw":
      applyDrawEffect(draft, effect.params);
      return;
    case "set_face_up":
      applySetFaceUpEffect(draft, effect.params);
      return;
    case "reveal_all":
      applyRevealAllEffect(draft, effect.params);
      return;
    case "end_turn":
      applyEndTurnEffect(draft);
      return;
    case "calculate_scores":
      applyCalculateScoresEffect(draft);
      return;
    case "determine_winners":
      applyDetermineWinnersEffect(draft);
      return;
    case "collect_all_to":
      applyCollectAllToEffect(draft, effect.params);
      return;
    case "reset_round":
      applyResetRoundEffect(draft);
      return;
    case "move_top":
      applyMoveTopEffect(draft, effect.params);
      return;
    case "flip_top":
      applyFlipTopEffect(draft, effect.params);
      return;
    case "move_all":
      applyMoveAllEffect(draft, effect.params);
      return;
    case "move_rank":
      applyMoveRankEffect(draft, effect.params);
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
      applySetVarEffect(draft, effect.params);
      return;
    case "set_str_var":
      applySetStrVarEffect(draft, effect.params);
      return;
    case "inc_var":
      applyIncVarEffect(draft, effect.params);
      return;
    case "collect_trick":
      applyCollectTrickEffect(draft, effect.params);
      return;
    case "set_lead_player":
      applySetLeadPlayerEffect(draft, effect.params);
      return;
    case "end_game":
      applyEndGameEffect(draft, rt.now);
      return;
    case "accumulate_scores":
      applyAccumulateScoresEffect(draft);
      return;
    default:
      assertNever(effect);
  }
}

// ─── Effect Guards ─────────────────────────────────────────────────

/** Returns the named zone or throws an {@link EffectError} naming the effect. */
function requireZone(draft: Draft, kind: EffectKind, zoneName: string): ZoneState {
  const zone = draft.state.zones[zoneName];
  if (!zone) throw missingZoneError(kind, zoneName);
  return zone;
}

/** Throws unless `playerIndex` addresses a seat at the table. */
function requirePlayerIndex(draft: Draft, kind: EffectKind, playerIndex: number): void {
  const count = draft.state.players.length;
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= count) {
    throw new EffectError(
      `Effect "${kind}" received player index ${playerIndex}, but there are ${count} players`,
      kind,
    );
  }
}

// ─── Effect Implementations ────────────────────────────────────────

/**
 * Shuffles all cards in a zone using the seeded RNG.
 */
function applyShuffleEffect(draft: Draft, params: ZoneParams, rng: SeededRng): void {
  const zone = requireZone(draft, "shuffle", params.zone);
  draft.zones()[params.zone] = { ...zone, cards: rng.shuffle(zone.cards) };
}

/**
 * Deals cards from a source zone to all per-player target zones.
 * For each player zone matching the template (e.g., "hand:0", "hand:1"),
 * moves `count` cards from the source.
 * Also handles non-per-player zones (e.g., "dealer_hand").
 */
function applyDealEffect(draft: Draft, params: TransferParams): void {
  const { from, to, count } = params;
  const fromZone = requireZone(draft, "deal", from);

  // Find all per-player variants of the "to" zone, or the exact zone
  const targetZones = Object.keys(draft.state.zones).filter(
    (name) => name === to || name.startsWith(`${to}:`),
  );
  if (targetZones.length === 0) throw missingZoneError("deal", to);

  const zones = draft.zones();
  const fromCards = [...fromZone.cards];

  for (const targetZone of targetZones) {
    const cardsToMove = fromCards.splice(0, count);
    const existing = zones[targetZone]!;
    zones[targetZone] = { ...existing, cards: [...existing.cards, ...cardsToMove] };
  }

  zones[from] = { ...fromZone, cards: fromCards };
}

/**
 * Draws cards from a source zone to a target zone for the current player.
 * Resolves per-player zone names if needed.
 */
function applyDrawEffect(draft: Draft, params: TransferParams): void {
  const { from, to, count } = params;
  const fromZone = requireZone(draft, "draw", from);

  // Resolve target zone — might be per-player
  const perPlayerName = `${to}:${draft.state.currentPlayerIndex}`;
  const targetName = to in draft.state.zones ? to : perPlayerName;
  const target = draft.state.zones[targetName];
  if (!target) throw missingZoneError("draw", to);

  const zones = draft.zones();
  const fromCards = [...fromZone.cards];
  const drawnCards = fromCards.splice(0, count);

  zones[from] = { ...fromZone, cards: fromCards };
  zones[targetName] = { ...target, cards: [...target.cards, ...drawnCards] };
}

/**
 * Sets a specific card's faceUp property in a zone.
 */
function applySetFaceUpEffect(draft: Draft, params: SetFaceUpParams): void {
  const { zone: zoneName, cardIndex, faceUp } = params;
  const zone = requireZone(draft, "set_face_up", zoneName);
  if (cardIndex < 0 || cardIndex >= zone.cards.length) {
    throw new EffectError(
      `Effect "set_face_up" card index ${cardIndex} is out of range for zone "${zoneName}" (${zone.cards.length} cards)`,
      "set_face_up",
    );
  }

  draft.zones()[zoneName] = {
    ...zone,
    cards: zone.cards.map((card, i) => (i === cardIndex ? { ...card, faceUp } : card)),
  };
}

/**
 * Sets all cards in a zone to faceUp: true.
 */
function applyRevealAllEffect(draft: Draft, params: ZoneParams): void {
  const zone = requireZone(draft, "reveal_all", params.zone);
  draft.zones()[params.zone] = {
    ...zone,
    cards: zone.cards.map((card) => ({ ...card, faceUp: true })),
  };
}

/**
 * Advances currentPlayerIndex to the next player. Wraps around.
 */
function applyEndTurnEffect(draft: Draft): void {
  const { state } = draft;
  state.currentPlayerIndex = nextPlayerIndex(
    state.currentPlayerIndex,
    state.turnDirection,
    state.players.length,
  );
  state.turnsTakenThisPhase += 1;
}

/**
 * Derives a zone map for an NPC role by finding zones it owns.
 * Strips the "{roleName}_" prefix to produce base keys.
 * Example: for dealer, "dealer_hand" → { hand: "dealer_hand" }
 */
function buildNpcZoneMap(
  roleName: string,
  zones: Readonly<Record<string, ZoneState>>,
): Readonly<Record<string, string>> {
  const zoneMap: Record<string, string> = {};
  const prefix = `${roleName}_`;
  for (const [zoneName, zone] of Object.entries(zones)) {
    if (zone.definition.owners.includes(roleName)) {
      // Strip role prefix if present; otherwise use zone name as-is
      const baseKey = zoneName.startsWith(prefix) ? zoneName.substring(prefix.length) : zoneName;
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
function applyCalculateScoresEffect(draft: Draft): void {
  const { state } = draft;
  const { roles, scoring } = state.ruleset;
  const scores = draft.scores();

  for (const role of roles) {
    if (role.isHuman) {
      // Score each human player
      for (let i = 0; i < state.players.length; i++) {
        if (!isHumanPlayer(state.players[i]!, roles)) continue;

        const result = evaluateExpression(scoring.method, { state, playerIndex: i });
        if (result.kind !== "number") {
          throw new Error(
            `scoring.method must return a number, got ${result.kind} for player ${i}`,
          );
        }
        scores[`player_score:${i}`] = result.value;
      }
    } else {
      // Score each NPC role
      const zoneMap = buildNpcZoneMap(role.name, state.zones);
      const ctx: EvalContext = { state, roleOverride: { roleName: role.name, zoneMap } };
      const result = evaluateExpression(scoring.method, ctx);
      if (result.kind !== "number") {
        throw new Error(
          `scoring.method must return a number, got ${result.kind} for role "${role.name}"`,
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
function applyDetermineWinnersEffect(draft: Draft): void {
  const { state } = draft;
  const { scoring, roles } = state.ruleset;
  const scores = draft.scores();

  for (let i = 0; i < state.players.length; i++) {
    if (!isHumanPlayer(state.players[i]!, roles)) continue;

    const myScore = scores[`player_score:${i}`] ?? 0;
    const bindings: Record<string, EvalResult> = {
      my_score: { kind: "number", value: myScore },
    };
    const ctx: EvalContext = { state, playerIndex: i, bindings };

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
 * Collects all cards from all zones into the specified target zone,
 * face-down. The target is checked before any source is emptied so a
 * typo in the ruleset cannot make the deck vanish.
 */
function applyCollectAllToEffect(draft: Draft, params: ZoneParams): void {
  const targetName = params.zone;
  const target = requireZone(draft, "collect_all_to", targetName);

  const zones = draft.zones();
  const collected: Card[] = [];

  for (const [name, zone] of Object.entries(zones)) {
    if (name === targetName) continue;
    collected.push(...zone.cards.map((card) => ({ ...card, faceUp: false })));
    zones[name] = { ...zone, cards: [] };
  }

  zones[targetName] = { ...target, cards: [...target.cards, ...collected] };
}

/**
 * Resets the round: clears scores, resets player index, increments turn.
 */
function applyResetRoundEffect(draft: Draft): void {
  const { state } = draft;
  Object.assign(state, resetRoundFields(state.ruleset, state.variables, state.turnNumber));
}

/**
 * Sets a custom variable to a specific value.
 */
function applySetVarEffect(draft: Draft, params: SetVarParams): void {
  draft.variables()[params.name] = params.value;
}

/**
 * Sets a custom string variable to a specific value.
 */
function applySetStrVarEffect(draft: Draft, params: SetStrVarParams): void {
  draft.stringVariables()[params.name] = params.value;
}

/**
 * Increments a custom variable by an amount.
 * If the variable doesn't exist yet, treats it as starting from 0.
 */
function applyIncVarEffect(draft: Draft, params: IncVarParams): void {
  const variables = draft.variables();
  variables[params.name] = (variables[params.name] ?? 0) + params.amount;
}

/**
 * Moves the top N cards from one zone to another.
 * If the source zone has fewer cards than `count`, moves all available.
 * Preserves card state (faceUp, etc.).
 */
function applyMoveTopEffect(draft: Draft, params: TransferParams): void {
  const { from, to, count } = params;
  const fromZone = requireZone(draft, "move_top", from);
  const toZone = requireZone(draft, "move_top", to);

  const zones = draft.zones();
  const fromCards = [...fromZone.cards];
  const movedCards = fromCards.splice(0, count);

  zones[from] = { ...fromZone, cards: fromCards };
  zones[to] = { ...toZone, cards: [...toZone.cards, ...movedCards] };
}

/**
 * Flips the top N cards in a zone to faceUp = true.
 * If the zone has fewer cards than `count`, flips all.
 */
function applyFlipTopEffect(draft: Draft, params: FlipTopParams): void {
  const { zone: zoneName, count } = params;
  const zone = requireZone(draft, "flip_top", zoneName);
  draft.zones()[zoneName] = {
    ...zone,
    cards: zone.cards.map((card, i) => (i < count ? { ...card, faceUp: true } : card)),
  };
}

/**
 * Moves ALL cards from one zone to another.
 * Cards retain their faceUp state.
 */
function applyMoveAllEffect(draft: Draft, params: MoveAllParams): void {
  const { from, to } = params;
  const fromZone = requireZone(draft, "move_all", from);
  const toZone = requireZone(draft, "move_all", to);

  const zones = draft.zones();
  zones[from] = { ...fromZone, cards: [] };
  zones[to] = { ...toZone, cards: [...toZone.cards, ...fromZone.cards] };
}

/**
 * Moves every card with the given rank from one zone to another.
 * Cards keep their relative order and faceUp state. No-op if no card
 * matches (nothing is lost — the cards simply stay where they are).
 */
function applyMoveRankEffect(draft: Draft, params: MoveRankParams): void {
  const { from, to, rank } = params;
  const fromZone = requireZone(draft, "move_rank", from);
  const toZone = requireZone(draft, "move_rank", to);

  const matching = fromZone.cards.filter((card) => card.rank === rank);
  if (matching.length === 0) return;
  const remaining = fromZone.cards.filter((card) => card.rank !== rank);

  const zones = draft.zones();
  zones[from] = { ...fromZone, cards: remaining };
  zones[to] = { ...toZone, cards: [...toZone.cards, ...matching] };
}

/**
 * Reverses the turn direction. Clockwise becomes counterclockwise and vice versa.
 */
function applyReverseTurnOrderEffect(draft: Draft): void {
  draft.state.turnDirection = draft.state.turnDirection === 1 ? -1 : 1;
}

/**
 * Skips the next player by advancing the current player index by one extra step
 * in the current turn direction.
 */
function applySkipNextPlayerEffect(draft: Draft): void {
  const { state } = draft;
  state.currentPlayerIndex = nextPlayerIndex(
    state.currentPlayerIndex,
    state.turnDirection,
    state.players.length,
  );
}

/**
 * Sets the current player to a specific index.
 */
function applySetNextPlayerEffect(draft: Draft, params: PlayerIndexParams): void {
  requirePlayerIndex(draft, "set_next_player", params.playerIndex);
  draft.state.currentPlayerIndex = params.playerIndex;
}

/**
 * Collects all cards from every `{prefix}:{N}` zone into a target zone.
 * Cards are set face-down (they go into a won pile, not displayed).
 * Source zones are emptied — after the target has been verified to exist.
 */
function applyCollectTrickEffect(draft: Draft, params: CollectTrickParams): void {
  const { zonePrefix, targetZone: targetName } = params;
  const target = requireZone(draft, "collect_trick", targetName);

  const sourceNames: string[] = [];
  for (let i = 0; i < draft.state.players.length; i++) {
    const name = `${zonePrefix}:${i}`;
    if (name in draft.state.zones) sourceNames.push(name);
  }
  if (sourceNames.length === 0) throw missingZoneError("collect_trick", `${zonePrefix}:*`);

  const zones = draft.zones();
  const collected: Card[] = [];
  for (const name of sourceNames) {
    const zone = zones[name]!;
    collected.push(...zone.cards.map((card) => ({ ...card, faceUp: false })));
    zones[name] = { ...zone, cards: [] };
  }

  zones[targetName] = { ...target, cards: [...target.cards, ...collected] };
}

/**
 * Sets `variables.lead_player` to the given player index AND sets
 * `currentPlayerIndex` to that player, so the trick winner leads next.
 */
function applySetLeadPlayerEffect(draft: Draft, params: PlayerIndexParams): void {
  requirePlayerIndex(draft, "set_lead_player", params.playerIndex);
  draft.variables().lead_player = params.playerIndex;
  draft.state.currentPlayerIndex = params.playerIndex;
}

/**
 * Transitions the game status to `{ kind: "finished" }`.
 * The winnerId is derived from scores: the player with `result:N === 1`.
 * If no clear winner, winnerId is null.
 */
function applyEndGameEffect(draft: Draft, now: () => number): void {
  const { state } = draft;
  let winnerId: PlayerId | null = null;

  for (let i = 0; i < state.players.length; i++) {
    if (state.scores[`result:${i}`] === 1) {
      winnerId = state.players[i]!.id;
      break;
    }
  }

  state.status = { kind: "finished", finishedAt: now(), winnerId };
}

/**
 * Accumulates each human player's round score into their cumulative score variable.
 * Reads scores["player_score:{i}"] and adds to variables["cumulative_score_{i}"].
 */
function applyAccumulateScoresEffect(draft: Draft): void {
  const { state } = draft;
  const variables = draft.variables();
  const { roles } = state.ruleset;

  for (let i = 0; i < state.players.length; i++) {
    if (!isHumanPlayer(state.players[i]!, roles)) continue;
    const roundScore = state.scores[`player_score:${i}`] ?? 0;
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
  rng: SeededRng,
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
 * `{name}:{playerIndex}` variants, one per human player, where
 * `playerIndex` is the player's index in `players` — the same index
 * `current_player`, `trick_winner`, and the state filter use.
 * All cards are placed in the draw pile.
 */
function initializeZones(
  ruleset: CardGameRuleset,
  players: readonly Player[],
  allCards: readonly Card[],
): Record<string, ZoneState> {
  const zones: Record<string, ZoneState> = {};

  // Build set of per-player role names
  const perPlayerRoles = new Set(
    ruleset.roles.filter((r) => r.count === "per_player").map((r) => r.name),
  );

  const humanIndices: number[] = [];
  for (let i = 0; i < players.length; i++) {
    if (isHumanPlayer(players[i]!, ruleset.roles)) humanIndices.push(i);
  }

  for (const zoneConfig of ruleset.zones) {
    const isPerPlayer = zoneConfig.owners.some((o) => perPlayerRoles.has(o));
    const names = isPerPlayer
      ? humanIndices.map((i) => `${zoneConfig.name}:${i}`)
      : [zoneConfig.name];

    for (const name of names) {
      const definition: ZoneDefinition = {
        name,
        visibility: zoneConfig.visibility,
        owners: zoneConfig.owners,
        maxCards: zoneConfig.maxCards,
        phaseOverrides: zoneConfig.phaseOverrides,
      };
      zones[name] = { definition, cards: [] };
    }
  }

  // Put all cards in the draw pile, or the first ownerless zone as a fallback
  const deckZoneName =
    "draw_pile" in zones
      ? "draw_pile"
      : Object.keys(zones).find((name) => zones[name]!.definition.owners.length === 0);
  if (deckZoneName === undefined) {
    throw new Error(
      `Ruleset "${ruleset.meta.slug}" has no "draw_pile" zone and no ownerless zone to hold the deck`,
    );
  }
  zones[deckZoneName] = { ...zones[deckZoneName]!, cards: [...allCards] };

  return zones;
}

// ─── Error Types ───────────────────────────────────────────────────

/** Error thrown when a ruleset fails to parse or validate. */
export class RulesetParseError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
    this.name = "RulesetParseError";
  }
}
