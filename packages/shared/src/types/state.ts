// ─── Game State & Actions ──────────────────────────────────────────
// Runtime state of a game in progress, plus the actions that mutate it.
// State is always immutable — the reducer returns a new state.

import type { Card, CardInstanceId, ZoneState } from "./card";
import type { CardGameRuleset, PhaseKind } from "./ruleset";

// ─── Player ────────────────────────────────────────────────────────

export type PlayerId = string & { readonly __brand: unique symbol };

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly role: string;
  readonly connected: boolean;
}

// ─── Game Status ───────────────────────────────────────────────────

/**
 * Discriminated union for game lifecycle.
 * Each status carries only the data relevant to that stage.
 */
export type GameStatus =
  | { readonly kind: "waiting_for_players" }
  | { readonly kind: "in_progress"; readonly startedAt: number }
  | { readonly kind: "paused"; readonly pausedAt: number }
  | {
      readonly kind: "finished";
      readonly finishedAt: number;
      readonly winnerId: PlayerId | null;
    };

// ─── Game State ────────────────────────────────────────────────────

export type GameSessionId = string & { readonly __brand: unique symbol };

/**
 * The complete, serializable state of a game at a point in time.
 * Designed for snapshot + action-log persistence.
 */
export interface CardGameState {
  readonly sessionId: GameSessionId;
  readonly ruleset: CardGameRuleset;
  readonly status: GameStatus;
  readonly players: readonly Player[];
  readonly zones: Readonly<Record<string, ZoneState>>;
  readonly currentPhase: string;
  readonly currentPlayerIndex: number;
  readonly turnNumber: number;
  readonly scores: Readonly<Record<string, number>>;
  readonly actionLog: readonly ResolvedAction[];
  /** Monotonically increasing version for optimistic concurrency. */
  readonly version: number;
}

// ─── Actions ───────────────────────────────────────────────────────

/**
 * All possible game actions as a discriminated union.
 * Each variant carries exactly the data needed — no optional fields.
 */
export type CardGameAction =
  | { readonly kind: "join"; readonly playerId: PlayerId; readonly name: string }
  | { readonly kind: "leave"; readonly playerId: PlayerId }
  | { readonly kind: "start_game" }
  | {
      readonly kind: "play_card";
      readonly playerId: PlayerId;
      readonly cardId: CardInstanceId;
      readonly fromZone: string;
      readonly toZone: string;
    }
  | {
      readonly kind: "draw_card";
      readonly playerId: PlayerId;
      readonly fromZone: string;
      readonly toZone: string;
      readonly count: number;
    }
  | {
      readonly kind: "declare";
      readonly playerId: PlayerId;
      readonly declaration: string;
    }
  | { readonly kind: "end_turn"; readonly playerId: PlayerId }
  | { readonly kind: "advance_phase" }
  | { readonly kind: "reset_round" };

/**
 * An action that has been validated and applied, with a timestamp.
 * Stored in the append-only action log.
 */
export interface ResolvedAction {
  readonly action: CardGameAction;
  readonly timestamp: number;
  readonly version: number;
}

// ─── Reducer Signature ─────────────────────────────────────────────

/**
 * A pure reducer function: (state, action) → new state.
 * Created by the RulesetInterpreter for a specific ruleset.
 */
export type GameReducer = (
  state: CardGameState,
  action: CardGameAction
) => CardGameState;

// ─── Player View ───────────────────────────────────────────────────

/**
 * A filtered projection of game state for a specific player.
 * Hidden cards are replaced with null to prevent information leaks.
 */
export interface PlayerView {
  readonly sessionId: GameSessionId;
  readonly status: GameStatus;
  readonly players: readonly Player[];
  readonly zones: Readonly<Record<string, FilteredZoneState>>;
  readonly currentPhase: string;
  readonly isMyTurn: boolean;
  readonly myPlayerId: PlayerId;
  readonly validActions: readonly CardGameAction["kind"][];
  readonly scores: Readonly<Record<string, number>>;
  readonly turnNumber: number;
}

/** A zone where hidden cards are replaced with placeholders. */
export interface FilteredZoneState {
  readonly name: string;
  readonly cards: readonly (Card | null)[];
  readonly cardCount: number;
}
