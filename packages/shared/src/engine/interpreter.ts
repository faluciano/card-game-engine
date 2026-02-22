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
import { getPresetDeck } from "../deck/presets";
import { PhaseMachine } from "./phase-machine";
import {
  registerAllBuiltins,
  type EffectDescription,
  type MutableEvalContext,
  computeHandValue,
} from "./builtins";
import { evaluateCondition, evaluateExpression } from "./expression-evaluator";
import {
  validateAction,
  executePhaseAction,
} from "./action-validator";
import { createRng, type SeededRng } from "./prng";

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

  // Build deck from preset templates with deterministic IDs
  const templates = getPresetDeck(ruleset.deck.preset);
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
    scores: {},
    actionLog: [],
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
        return handlePlayCard(state, action, phaseMachine);
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
    phaseMachine
  );

  let newState = applyEffects(state, effects, rng);

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
 * Handles a "play_card" action — moves a specific card between zones.
 */
function handlePlayCard(
  state: CardGameState,
  action: Extract<CardGameAction, { kind: "play_card" }>,
  phaseMachine: PhaseMachine
): CardGameState {
  const validation = validateAction(state, action, phaseMachine);
  if (!validation.valid) return state;

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

  const humanPlayers = state.players.filter((p) => p.role !== "dealer");
  const nextPlayerIndex =
    (state.currentPlayerIndex + 1) % humanPlayers.length;

  let newState: CardGameState = {
    ...state,
    currentPlayerIndex: nextPlayerIndex,
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
    scores: {},
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
  const humanPlayers = state.players.filter((p) => p.role !== "dealer");
  const nextIndex = (state.currentPlayerIndex + 1) % humanPlayers.length;

  return {
    ...state,
    currentPlayerIndex: nextIndex,
  };
}

/**
 * Calculates scores for all players using the ruleset's card values.
 * Stores hand values in state.scores keyed by player index.
 */
function applyCalculateScoresEffect(state: CardGameState): CardGameState {
  const cardValues = state.ruleset.deck.cardValues;
  const scores: Record<string, number> = {};

  // Score each player's hand
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i]!;
    if (player.role === "dealer") continue;

    // Try per-player zone first, then shared zone
    const perPlayerZone = state.zones[`hand:${i}`];
    const sharedZone = state.zones["hand"];
    const zone = perPlayerZone ?? sharedZone;
    if (zone) {
      scores[`player:${i}`] = computeHandValue(zone.cards, cardValues, 21);
    }
  }

  // Score dealer hand
  const dealerHand = state.zones["dealer_hand"];
  if (dealerHand) {
    scores["dealer"] = computeHandValue(dealerHand.cards, cardValues, 21);
  }

  return { ...state, scores };
}

/**
 * Determines winners by comparing player scores to dealer score.
 * In blackjack: player wins if not busted AND (score > dealer OR dealer busted).
 */
function applyDetermineWinnersEffect(state: CardGameState): CardGameState {
  const dealerScore = state.scores["dealer"] ?? 0;
  const dealerBusted = dealerScore > 21;
  const scores = { ...state.scores };

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i]!;
    if (player.role === "dealer") continue;

    const playerScore = scores[`player:${i}`] ?? 0;
    const playerBusted = playerScore > 21;

    if (playerBusted) {
      scores[`result:${i}`] = -1; // loss
    } else if (dealerBusted || playerScore > dealerScore) {
      scores[`result:${i}`] = 1; // win
    } else if (playerScore === dealerScore) {
      scores[`result:${i}`] = 0; // push/tie
    } else {
      scores[`result:${i}`] = -1; // loss
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
    collected.push(...zone.cards);
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
  return {
    ...state,
    currentPlayerIndex: 0,
    turnNumber: state.turnNumber + 1,
    scores: {},
  };
}

// ─── Deterministic Card Creation ───────────────────────────────────

interface CardTemplate {
  readonly suit: string;
  readonly rank: string;
}

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
      const humanPlayers = players.filter((p) => p.role !== "dealer");
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
