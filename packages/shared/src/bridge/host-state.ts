// ─── Host Bridge State ─────────────────────────────────────────────
// Reconciles the card engine's CardGameState (array-based players,
// discriminated-union status) with CouchKit's IGameState (Record-based
// players, string status). This is the single source of truth for the
// host app's navigation and game lifecycle.

import type { IGameState, IPlayer } from "@couch-kit/core";
import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
  GameReducer,
} from "../types/index.js";

// ─── Screen Navigation ─────────────────────────────────────────────

/**
 * Screen-level navigation for the host app.
 * Discriminated on `tag` for exhaustive switch coverage.
 */
export type HostScreen =
  | { readonly tag: "ruleset_picker" }
  | {
      readonly tag: "lobby";
      readonly ruleset: CardGameRuleset;
      readonly engineReducer: GameReducer;
    }
  | {
      readonly tag: "game_table";
      readonly ruleset: CardGameRuleset;
      readonly engineReducer: GameReducer;
    };

// ─── Host Game State ───────────────────────────────────────────────

/**
 * The canonical state for the CouchKit host provider.
 * Extends IGameState for CouchKit compatibility while wrapping the
 * card engine state.
 */
export interface HostGameState extends IGameState {
  /** CouchKit-required string status — derived from current screen/engine state. */
  readonly status: string;
  /** CouchKit-managed player record. */
  readonly players: Record<string, IPlayer>;
  /** Current screen navigation state. */
  readonly screen: HostScreen;
  /** Card engine state — null until game starts. */
  readonly engineState: CardGameState | null;
}

// ─── Host Actions ──────────────────────────────────────────────────

/**
 * All host-level actions as a discriminated union.
 * Uses `type` (not `kind`) because CouchKit's IAction requires `type: string`.
 */
export type HostAction =
  | { readonly type: "SELECT_RULESET"; readonly ruleset: CardGameRuleset }
  | { readonly type: "BACK_TO_PICKER" }
  | { readonly type: "START_GAME"; readonly seed?: number }
  | { readonly type: "GAME_ACTION"; readonly action: CardGameAction }
  | { readonly type: "RESET_ROUND" }
  | { readonly type: "ADVANCE_PHASE" };
