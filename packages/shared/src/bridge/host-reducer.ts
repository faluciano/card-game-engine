// ─── Host Bridge Reducer ───────────────────────────────────────────
// Bridges CouchKit's IGameState world (Record-based players, string
// status) with the card engine's CardGameState world (array-based
// players, discriminated-union status). Handles screen navigation,
// game lifecycle, and delegates in-game actions to the engine reducer.

import { createReducer, createInitialState } from "../engine/index";
import type {
  CardGameAction,
  CardGameRuleset,
  GameReducer,
  Player,
  PlayerId,
  GameSessionId,
} from "../types/index";
import type { HostAction, HostGameState, HostScreen } from "./host-state";

// ─── Lazy Reducer Cache ────────────────────────────────────────────

// Module-level cache: ruleset → reducer. WeakMap allows GC when ruleset is dropped.
const reducerCache = new WeakMap<CardGameRuleset, GameReducer>();

function getOrCreateReducer(ruleset: CardGameRuleset): GameReducer {
  let reducer = reducerCache.get(ruleset);
  if (!reducer) {
    reducer = createReducer(ruleset);
    reducerCache.set(ruleset, reducer);
  }
  return reducer;
}

// ─── Initial State Factory ─────────────────────────────────────────

/**
 * Creates the initial host state — no ruleset selected, no players,
 * no engine state. CouchKit will populate `players` as clients connect.
 */
export function createHostInitialState(): HostGameState {
  return {
    status: "ruleset_picker",
    players: {},
    screen: { tag: "ruleset_picker" },
    engineState: null,
  };
}

// ─── Status Derivation ─────────────────────────────────────────────

/**
 * Derives a flat CouchKit-compatible status string from the host screen
 * and engine state. Format:
 * - `"ruleset_picker"` / `"lobby"` for pre-game screens
 * - `"game:<engine_status_kind>"` for in-game states
 */
export function deriveStatus(screen: HostScreen, engineState: HostGameState["engineState"]): string {
  switch (screen.tag) {
    case "ruleset_picker":
      return "ruleset_picker";
    case "lobby":
      return "lobby";
    case "game_table":
      return engineState ? `game:${engineState.status.kind}` : "game:unknown";
  }
}

// ─── Reducer Implementation ────────────────────────────────────────

export function hostReducerImpl(state: HostGameState, action: HostAction): HostGameState {
  switch (action.type) {
    case "SELECT_RULESET":
      return handleSelectRuleset(state, action.ruleset);

    case "BACK_TO_PICKER":
      return handleBackToPicker(state);

    case "START_GAME":
      return handleStartGame(state, action.seed);

    case "GAME_ACTION":
      return handleGameAction(state, action.action);

    case "RESET_ROUND":
      return handleResetRound(state);

    case "ADVANCE_PHASE":
      return handleAdvancePhase(state);

    default:
      return state;
  }
}

/** Raw reducer — CouchKit's GameHostProvider wraps it internally. */
export const hostReducer = hostReducerImpl;

// ─── Action Handlers ───────────────────────────────────────────────

function handleSelectRuleset(
  state: HostGameState,
  ruleset: CardGameRuleset,
): HostGameState {
  const screen: HostScreen = { tag: "lobby", ruleset };

  return {
    ...state,
    status: deriveStatus(screen, null),
    screen,
    engineState: null,
  };
}

function handleBackToPicker(state: HostGameState): HostGameState {
  const screen: HostScreen = { tag: "ruleset_picker" };

  return {
    ...state,
    status: deriveStatus(screen, null),
    screen,
    engineState: null,
  };
}

function handleStartGame(state: HostGameState, seed?: number): HostGameState {
  // Guard: must be in lobby with a ruleset selected
  if (state.screen.tag !== "lobby") return state;

  const { ruleset } = state.screen;

  // Map CouchKit's Record<string, IPlayer> → engine's Player[]
  const enginePlayers: Player[] = Object.entries(state.players).map(
    ([id, couchPlayer]) => ({
      id: id as PlayerId,
      name: couchPlayer.name,
      role: "player",
      connected: couchPlayer.connected,
    }),
  );

  // Guard: need at least one player to create a session
  if (enginePlayers.length === 0) return state;

  const sessionId = crypto.randomUUID() as GameSessionId;
  const engineState = createInitialState(ruleset, sessionId, enginePlayers, seed);

  const screen: HostScreen = { tag: "game_table", ruleset };

  return {
    ...state,
    status: deriveStatus(screen, engineState),
    screen,
    engineState,
  };
}

function handleGameAction(
  state: HostGameState,
  action: CardGameAction,
): HostGameState {
  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const engineReducer = getOrCreateReducer(state.screen.ruleset);
  const engineState = engineReducer(state.engineState, action);

  return {
    ...state,
    status: deriveStatus(state.screen, engineState),
    engineState,
  };
}

function handleResetRound(state: HostGameState): HostGameState {
  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const engineReducer = getOrCreateReducer(state.screen.ruleset);
  const engineState = engineReducer(state.engineState, { kind: "reset_round" });

  return {
    ...state,
    status: deriveStatus(state.screen, engineState),
    engineState,
  };
}

function handleAdvancePhase(state: HostGameState): HostGameState {
  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const engineReducer = getOrCreateReducer(state.screen.ruleset);
  const engineState = engineReducer(state.engineState, { kind: "advance_phase" });

  return {
    ...state,
    status: deriveStatus(state.screen, engineState),
    engineState,
  };
}
