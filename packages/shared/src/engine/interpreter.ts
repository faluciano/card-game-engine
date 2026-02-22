// ─── Ruleset Interpreter ───────────────────────────────────────────
// Transforms a static CardGameRuleset into runtime constructs:
// a reducer function, initial state factory, and phase machine.

import type {
  CardGameRuleset,
  CardGameState,
  GameReducer,
  GameSessionId,
  Player,
} from "../types/index.js";

/**
 * Loads and validates a raw JSON object into a trusted CardGameRuleset.
 * This is the parse boundary — after this, the ruleset is guaranteed valid.
 *
 * @throws {RulesetParseError} if the JSON does not conform to the schema.
 */
export function loadRuleset(raw: unknown): CardGameRuleset {
  // TODO: Validate raw JSON against Zod schema
  // TODO: Return parsed, frozen CardGameRuleset
  throw new Error("Not implemented: loadRuleset");
}

/**
 * Creates a pure reducer function bound to a specific ruleset.
 * The reducer handles all game actions according to the ruleset's
 * phases, rules, and transitions.
 */
export function createReducer(ruleset: CardGameRuleset): GameReducer {
  // TODO: Build phase machine from ruleset.phases
  // TODO: Build action handlers from phase actions
  // TODO: Return (state, action) => newState reducer
  throw new Error("Not implemented: createReducer");
}

/**
 * Creates the initial game state for a ruleset with the given players.
 * Shuffles the deck, distributes to zones per the ruleset, and sets
 * the first phase.
 */
export function createInitialState(
  ruleset: CardGameRuleset,
  sessionId: GameSessionId,
  players: readonly Player[]
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

  // TODO: Build deck from ruleset.deck using deck presets
  // TODO: Shuffle deck
  // TODO: Initialize zones with cards per ruleset.zones
  // TODO: Set initial phase to first phase in ruleset.phases
  // TODO: Return frozen CardGameState
  throw new Error("Not implemented: createInitialState");
}

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
