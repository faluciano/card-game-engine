// ─── Host Bridge Reducer ───────────────────────────────────────────
// Bridges CouchKit's IGameState world (Record-based players, string
// status) with the card engine's CardGameState world (array-based
// players, discriminated-union status). Handles screen navigation,
// game lifecycle, and delegates in-game actions to the engine reducer.

import { createGameReducer } from "@couch-kit/core";
import {
  createReducer,
  createInitialState,
  type CardGameAction,
  type CardGameRuleset,
  type Player,
  type PlayerId,
  type GameSessionId,
} from "@card-engine/shared";
import type { HostAction, HostGameState, HostScreen } from "../types/host-state.js";

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
function deriveStatus(screen: HostScreen, engineState: HostGameState["engineState"]): string {
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

function hostReducerImpl(state: HostGameState, action: HostAction): HostGameState {
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

/** Wraps with CouchKit's internal-action handling (__PLAYER_JOINED__, etc.). */
export const hostReducer = createGameReducer(hostReducerImpl);

// ─── Action Handlers ───────────────────────────────────────────────

function handleSelectRuleset(
  state: HostGameState,
  ruleset: CardGameRuleset,
): HostGameState {
  const engineReducer = createReducer(ruleset);
  const screen: HostScreen = { tag: "lobby", ruleset, engineReducer };

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

  const { ruleset, engineReducer } = state.screen;

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

  const screen: HostScreen = { tag: "game_table", ruleset, engineReducer };

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

  const { engineReducer } = state.screen;
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

  const { engineReducer } = state.screen;
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

  const { engineReducer } = state.screen;
  const engineState = engineReducer(state.engineState, { kind: "advance_phase" });

  return {
    ...state,
    status: deriveStatus(state.screen, engineState),
    engineState,
  };
}
