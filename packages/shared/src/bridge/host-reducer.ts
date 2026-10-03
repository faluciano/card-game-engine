// ─── Host Bridge Reducer ───────────────────────────────────────────
// Bridges CouchKit's IGameState world (Record-based players, string
// status) with the card engine's CardGameState world (array-based
// players, discriminated-union status). Handles screen navigation,
// game lifecycle, and delegates in-game actions to the engine.

import type {
  CardGameAction,
  CardGameRuleset,
  GameSessionId,
  Player,
  PlayerId,
} from "../types/index";
import type { HostAction, HostGameState, HostScreen, InstalledGame } from "./host-state";
import { createInitialState } from "../engine/interpreter";
import { generateSeed } from "../engine/prng";
import { getEngine } from "./engine-cache";

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * A 128-bit hex session ID. Built from `generateSeed`, which already
 * handles the crypto / Hermes fallback, rather than duplicating it.
 */
function generateSessionId(): GameSessionId {
  const word = () => generateSeed().toString(16).padStart(8, "0");
  return `${word()}-${word()}-${word()}-${word()}` as GameSessionId;
}

/**
 * Engine actions a client may send through GAME_ACTION. Everything else is
 * host-only: phase pacing (`advance_phase`, `step_phase`, `reset_round`) is
 * driven by the host orchestrator, and the roster/lifecycle actions
 * (`join`, `leave`, `start_game`) are owned by CouchKit and START_GAME — a
 * client sending them could impersonate or add players.
 */
const CLIENT_ACTION_KINDS: ReadonlySet<CardGameAction["kind"]> = new Set([
  "play_card",
  "draw_card",
  "declare",
  "end_turn",
]);

/** Host-only engine actions, dispatched via their own HostAction types. */
type InternalActionKind = "advance_phase" | "step_phase" | "reset_round";

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
export function deriveStatus(
  screen: HostScreen,
  engineState: HostGameState["engineState"],
): string {
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
      return handleStartGame(state, action.seed ?? generateSeed());

    case "GAME_ACTION":
      return handleGameAction(state, action.action);

    case "RESET_ROUND":
      return handleInternalAction(state, "reset_round");

    case "ADVANCE_PHASE":
      return handleInternalAction(state, "advance_phase");

    case "STEP_PHASE":
      return handleInternalAction(state, "step_phase");

    case "INSTALL_RULESET":
      return handleInstallRuleset(state, action.ruleset, action.slug);

    case "UNINSTALL_RULESET":
      return handleUninstallRuleset(state, action.slug);

    case "SET_INSTALLED_SLUGS":
      return handleSetInstalledSlugs(state, action.slugs);

    default:
      // Unknown action types arrive over the wire from CouchKit; ignore them.
      return state;
  }
}

/** Raw reducer — CouchKit's GameHostProvider wraps it internally. */
export const hostReducer = hostReducerImpl;

// ─── Action Handlers ───────────────────────────────────────────────

function handleSelectRuleset(state: HostGameState, ruleset: CardGameRuleset): HostGameState {
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

function handleStartGame(state: HostGameState, seed: number): HostGameState {
  // Guard: must be in lobby with a ruleset selected
  if (state.screen.tag !== "lobby") return state;

  const { ruleset } = state.screen;

  // Map CouchKit's Record<string, IPlayer> → engine's Player[]
  const enginePlayers: Player[] = Object.entries(state.players).map(([id, couchPlayer]) => ({
    id: id as PlayerId,
    name: couchPlayer.name,
    role: "player",
    connected: couchPlayer.connected,
  }));

  // Guard: player count must fit the ruleset (createInitialState would throw)
  const { min, max } = ruleset.meta.players;
  if (enginePlayers.length === 0) return state;
  if (enginePlayers.length < min || enginePlayers.length > max) return state;

  const initialEngineState = createInitialState(ruleset, generateSessionId(), enginePlayers, seed);

  // Immediately transition from waiting_for_players → in_progress and run deal phase
  const result = getEngine(ruleset).apply(initialEngineState, { kind: "start_game" });
  if (result.kind === "rejected") return state;

  const screen: HostScreen = { tag: "game_table", ruleset };

  return {
    ...state,
    status: deriveStatus(screen, result.state),
    screen,
    engineState: result.state,
  };
}

function handleGameAction(state: HostGameState, action: CardGameAction): HostGameState {
  // Guard: only player moves may come from clients
  if (!CLIENT_ACTION_KINDS.has(action.kind)) return state;

  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const result = getEngine(state.screen.ruleset).apply(state.engineState, action);

  if (result.kind === "rejected") {
    const playerId = "playerId" in action ? action.playerId : "unknown";
    return {
      ...state,
      // Wall-clock time is fine here: it only keys the client's error toast
      // and never feeds back into engine state.
      actionError: { playerId, reason: result.reason, timestamp: Date.now() },
    };
  }

  // Successful action — update engine state and clear any previous error
  return {
    ...state,
    status: deriveStatus(state.screen, result.state),
    engineState: result.state,
    actionError: null,
  };
}

/**
 * Applies a host-only engine action (RESET_ROUND / ADVANCE_PHASE /
 * STEP_PHASE). A rejection — e.g. no transition to advance — leaves the
 * host state untouched.
 */
function handleInternalAction(state: HostGameState, kind: InternalActionKind): HostGameState {
  // Guard: must be on game table with active engine state
  if (state.screen.tag !== "game_table") return state;
  if (state.engineState === null) return state;

  const result = getEngine(state.screen.ruleset).apply(state.engineState, { kind });
  if (result.kind === "rejected") return state;

  return {
    ...state,
    status: deriveStatus(state.screen, result.state),
    engineState: result.state,
  };
}

function handleInstallRuleset(
  state: HostGameState,
  ruleset: CardGameRuleset,
  slug: string,
): HostGameState {
  // Guard: skip install if already installed with same version
  const existing = state.installedSlugs.find((ig) => ig.slug === slug);
  if (existing && existing.version === ruleset.meta.version) {
    return state;
  }

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

function handleUninstallRuleset(state: HostGameState, slug: string): HostGameState {
  // Guard: can only uninstall from picker or lobby
  if (state.screen.tag === "game_table") return state;

  // Guard: slug must be in the installed list
  const isInstalled = state.installedSlugs.some((ig) => ig.slug === slug);
  if (!isInstalled) return state;

  // Guard: cannot uninstall the currently-selected lobby game
  if (state.screen.tag === "lobby" && state.screen.ruleset.meta.slug === slug) {
    return state;
  }

  return {
    ...state,
    pendingUninstall: slug,
  };
}
