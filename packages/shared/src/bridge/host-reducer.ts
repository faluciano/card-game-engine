// ─── Host Bridge Reducer ───────────────────────────────────────────
// Bridges CouchKit's IGameState world (Record-based players, string
// status) with the card engine's CardGameState world (array-based
// players, discriminated-union status). Handles screen navigation,
// game lifecycle, and delegates in-game actions to the engine reducer.

import { createReducer, createInitialState, validateAction } from "../engine/index";
import type {
  CardGameAction,
  CardGameRuleset,
  GameReducer,
  Player,
  PlayerId,
  GameSessionId,
} from "../types/index";
import type { HostAction, HostGameState, HostScreen, InstalledGame } from "./host-state";

// ─── Helpers ───────────────────────────────────────────────────────

/** Crypto-quality session ID. Falls back to Math.random() on Hermes. */
function generateSessionId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for Hermes (no crypto.randomUUID)
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(0x8 | (Math.random() * 0x4) | 0).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

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
    installedSlugs: [],
    pendingInstall: null,
    pendingUninstall: null,
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
      return handleStartGame(state);

    case "GAME_ACTION":
      return handleGameAction(state, action.action);

    case "RESET_ROUND":
      return handleResetRound(state);

    case "ADVANCE_PHASE":
      return handleAdvancePhase(state);

    case "INSTALL_RULESET":
      return handleInstallRuleset(state, action.ruleset, action.slug);

    case "UNINSTALL_RULESET":
      return handleUninstallRuleset(state, action.slug);

    case "SET_INSTALLED_SLUGS":
      return handleSetInstalledSlugs(state, action.slugs);

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
  // Guard: block during active game — can only select from picker or lobby
  if (state.screen.tag === "game_table") return state;

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

function handleStartGame(state: HostGameState): HostGameState {
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

  const sessionId = generateSessionId() as GameSessionId;
  const initialEngineState = createInitialState(ruleset, sessionId, enginePlayers);

  // Immediately transition from waiting_for_players → in_progress and run deal phase
  const engineReducer = getOrCreateReducer(ruleset);
  const engineState = engineReducer(initialEngineState, { kind: "start_game" });

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
  // Guard: block engine-internal actions from client submissions
  if (action.kind === "advance_phase" || action.kind === "reset_round") {
    return state;
  }

  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const engineReducer = getOrCreateReducer(state.screen.ruleset);
  const prevEngineState = state.engineState;
  const engineState = engineReducer(prevEngineState, action);

  // Referential equality check: if the engine returned the same object,
  // the action was rejected (validation failure inside the engine reducer).
  if (engineState === prevEngineState) {
    // Determine the rejection reason via validateAction
    const validation = validateAction(prevEngineState, action);
    const playerId = "playerId" in action ? (action as { playerId: string }).playerId : "unknown";
    const reason = !validation.valid ? validation.reason : "Action rejected by engine";

    return {
      ...state,
      actionError: { playerId, reason, timestamp: Date.now() },
    };
  }

  // Successful action — update engine state and clear any previous error
  return {
    ...state,
    status: deriveStatus(state.screen, engineState),
    engineState,
    actionError: null,
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

function handleInstallRuleset(
  state: HostGameState,
  ruleset: CardGameRuleset,
  slug: string,
): HostGameState {
  return {
    ...state,
    pendingInstall: { ruleset, slug },
  };
}

function handleSetInstalledSlugs(
  state: HostGameState,
  slugs: readonly InstalledGame[],
): HostGameState {
  return {
    ...state,
    installedSlugs: slugs,
    pendingInstall: null,
    pendingUninstall: null,
  };
}

function handleUninstallRuleset(
  state: HostGameState,
  slug: string,
): HostGameState {
  // Guard: can only uninstall from picker or lobby
  if (state.screen.tag === "game_table") return state;

  // Guard: slug must be in the installed list
  const isInstalled = state.installedSlugs.some((ig) => ig.slug === slug);
  if (!isInstalled) return state;

  // Guard: cannot uninstall the currently-selected lobby game
  if (
    state.screen.tag === "lobby" &&
    state.screen.ruleset.meta.slug === slug
  ) {
    return state;
  }

  return {
    ...state,
    pendingUninstall: slug,
  };
}
