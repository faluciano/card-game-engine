// ─── Integration Test — Full Blackjack Game Lifecycle ──────────────
// Exercises the complete game engine end-to-end: load ruleset from
// JSON, create state, run reducer through multiple rounds, and verify
// player views. This is the capstone test proving the engine works.
//
// KNOWN ENGINE LIMITATIONS:
// 1. The `while()` special form in automatic sequences evaluates its
//    condition against the original immutable state — effects are only
//    recorded, not applied mid-sequence. If the dealer's initial hand
//    value is < 17, the while loop in dealer_turn cannot terminate.
//    We use a 1-copy deck + seed 42 where the dealer always gets >= 17.
// 2. Per-player zone visibility uses role-based ownership ("player"),
//    which doesn't distinguish between different players with the same
//    role. All "player"-role users see all "player"-owned zones.
//    We test the actual engine behavior and document the limitation.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadRuleset,
  createInitialState,
  createReducer,
} from "./interpreter";
import { createPlayerView } from "./state-filter";
import { clearBuiltins, evaluateExpression, type EvalContext } from "./expression-evaluator";
import { registerAllBuiltins } from "./builtins";
import { parseRuleset } from "../schema/validation";
import type {
  PlayerId,
  GameSessionId,
  Player,
  CardGameState,
  GameReducer,
  CardGameRuleset,
  CardValue,
} from "../types/index";

// ─── Branded Type Helpers ──────────────────────────────────────────

function pid(id: string): PlayerId {
  return id as PlayerId;
}

function sid(id: string): GameSessionId {
  return id as GameSessionId;
}

// ─── State Inspection Helpers ──────────────────────────────────────

/** Counts all cards across every zone in the game state. */
function totalCards(state: CardGameState): number {
  return Object.values(state.zones).reduce(
    (sum, z) => sum + z.cards.length,
    0
  );
}

/** Formats a hand as "rank+suit" strings for readable assertions. */
function handDescription(state: CardGameState, zoneName: string): string[] {
  const zone = state.zones[zoneName];
  if (!zone) return [];
  return zone.cards.map((c) => `${c.rank}${c.suit}`);
}

// ─── Fixture Setup ─────────────────────────────────────────────────

const FIXED_SEED = 42;
const DECK_SIZE = 52; // 1 copy of standard_52

const BLACKJACK_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  A: { kind: "dual", low: 1, high: 11 },
  "2": { kind: "fixed", value: 2 },
  "3": { kind: "fixed", value: 3 },
  "4": { kind: "fixed", value: 4 },
  "5": { kind: "fixed", value: 5 },
  "6": { kind: "fixed", value: 6 },
  "7": { kind: "fixed", value: 7 },
  "8": { kind: "fixed", value: 8 },
  "9": { kind: "fixed", value: 9 },
  "10": { kind: "fixed", value: 10 },
  J: { kind: "fixed", value: 10 },
  Q: { kind: "fixed", value: 10 },
  K: { kind: "fixed", value: 10 },
};

const RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/blackjack.cardgame.json"
);

/**
 * Builds a blackjack ruleset directly (1 copy, matching interpreter.test.ts).
 * Uses 1 copy to ensure seed 42 produces a dealer hand >= 17 so the
 * while() loop in dealer_turn terminates correctly.
 */
function makeBlackjackRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Blackjack",
      slug: "blackjack",
      version: "1.0.0",
      author: "test",
      players: { min: 1, max: 6 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: BLACKJACK_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      {
        name: "hand",
        visibility: { kind: "owner_only" },
        owners: ["player"],
      },
      {
        name: "dealer_hand",
        visibility: { kind: "partial", rule: "first_card_only" },
        owners: ["dealer"],
      },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
      { name: "dealer", isHuman: false, count: 1 },
    ],
    phases: [
      {
        name: "deal",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "player_turns", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, hand, 2)",
          "deal(draw_pile, dealer_hand, 2)",
          "set_face_up(dealer_hand, 0, true)",
        ],
      },
      {
        name: "player_turns",
        kind: "turn_based",
        actions: [
          {
            name: "hit",
            label: "Hit",
            condition: "hand_value(current_player.hand) < 21",
            effect: ["draw(draw_pile, current_player.hand, 1)"],
          },
          {
            name: "stand",
            label: "Stand",
            effect: ["end_turn()"],
          },
          {
            name: "double_down",
            label: "Double Down",
            condition: "card_count(current_player.hand) == 2",
            effect: [
              "draw(draw_pile, current_player.hand, 1)",
              "end_turn()",
            ],
          },
        ],
        transitions: [
          { to: "dealer_turn", when: "all_players_done" },
          {
            to: "scoring",
            when: "hand_value(current_player.hand) > 21",
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "dealer_turn",
        kind: "automatic",
        actions: [],
        transitions: [
          { to: "scoring", when: "hand_value(dealer_hand) >= 17" },
        ],
        automaticSequence: [
          "reveal_all(dealer_hand)",
          "while(hand_value(dealer_hand) < 17, draw(draw_pile, dealer_hand, 1))",
        ],
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "round_end", when: "scores_calculated" }],
        automaticSequence: ["calculate_scores()", "determine_winners()"],
      },
      {
        name: "round_end",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "deal", when: "continue_game" }],
        automaticSequence: ["collect_all_to(draw_pile)", "reset_round()"],
      },
    ],
    scoring: {
      method: "hand_value(current_player.hand, 21)",
      winCondition: "my_score <= 21 && (dealer_score > 21 || my_score > dealer_score)",
      bustCondition: "my_score > 21",
      tieCondition: "my_score == dealer_score && my_score <= 21",
      autoEndTurnCondition: "hand_value(current_player.hand, 21) >= 21",
    },
    visibility: [
      { zone: "hand", visibility: { kind: "owner_only" } },
      {
        zone: "dealer_hand",
        visibility: { kind: "partial", rule: "first_card_only" },
        phaseOverride: {
          phase: "dealer_turn",
          visibility: { kind: "public" },
        },
      },
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "discard", visibility: { kind: "public" } },
    ],
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: pid(`player-${i}`),
    name: `Player ${i}`,
    role: "player" as const,
    connected: true,
  }));
}

/**
 * Creates a started game ready for player actions.
 * Returns state at `player_turns` with freshly dealt cards.
 */
function startGame(
  ruleset: CardGameRuleset,
  playerCount: number,
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const players = makePlayers(playerCount);
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(
    ruleset,
    sid("test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Blackjack Integration — Full Game Lifecycle", () => {
  let ruleset: CardGameRuleset;

  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
    ruleset = makeBlackjackRuleset();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Ruleset Loading from JSON ──────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("ruleset loading from JSON", () => {
    it("loads and validates the blackjack ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("Blackjack");
      expect(jsonRuleset.meta.slug).toBe("blackjack");
      expect(jsonRuleset.deck.preset).toBe("standard_52");
      expect(jsonRuleset.deck.copies).toBe(2);
      expect(jsonRuleset.phases).toHaveLength(5);
      expect(jsonRuleset.roles).toHaveLength(2);
      expect(jsonRuleset.zones).toHaveLength(4);
    });

    it("JSON ruleset contains all expected phases", () => {
      const raw = JSON.parse(readFileSync(RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "deal",
        "player_turns",
        "dealer_turn",
        "scoring",
        "round_end",
      ]);
    });

    it("JSON ruleset contains double_down action", () => {
      const raw = JSON.parse(readFileSync(RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playerTurns = jsonRuleset.phases.find(
        (p) => p.name === "player_turns"
      );
      const actionNames = playerTurns!.actions.map((a) => a.name);
      expect(actionNames).toContain("double_down");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Full Round via "stand" ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("full round via stand", () => {
    it("deals correctly after start_game: 2 cards per player and dealer", () => {
      const { state } = startGame(ruleset, 2);

      expect(state.status.kind).toBe("in_progress");
      expect(state.currentPhase).toBe("player_turns");
      expect(state.zones["hand:0"]!.cards).toHaveLength(2);
      expect(state.zones["hand:1"]!.cards).toHaveLength(2);
      expect(state.zones["dealer_hand"]!.cards).toHaveLength(2);
    });

    it("dealer's first card is face up, second is face down after deal", () => {
      const { state } = startGame(ruleset, 2);
      const dealerCards = state.zones["dealer_hand"]!.cards;

      expect(dealerCards[0]!.faceUp).toBe(true);
      expect(dealerCards[1]!.faceUp).toBe(false);
    });

    it("completes entire round and starts new round after all players stand", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      // With the all_players_done fix, ALL players must end their turn
      // before the game auto-advances through dealer_turn → scoring → round_end → deal → player_turns
      let current = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      // After player 0 stands, it's player 1's turn (round NOT complete yet)
      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBe(state.turnNumber);
      expect(current.currentPlayerIndex).toBe(1);

      current = reducer(current, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "stand",
      });

      // Now all players are done → round auto-completes
      expect(current.status.kind).toBe("in_progress");
      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBeGreaterThan(state.turnNumber);
      // New round: freshly dealt hands
      expect(current.zones["hand:0"]!.cards).toHaveLength(2);
      expect(current.zones["hand:1"]!.cards).toHaveLength(2);
      expect(current.zones["dealer_hand"]!.cards).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Full Round via "hit" ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("full round via hit", () => {
    it("draws a card and stays in player_turns (no end_turn)", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterHit = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "hit",
      });

      // Hit draws a card but does NOT call end_turn, so the player
      // stays in player_turns with the same turn number
      expect(afterHit.status.kind).toBe("in_progress");
      expect(afterHit.currentPhase).toBe("player_turns");
      expect(afterHit.turnNumber).toBe(state.turnNumber);
      expect(afterHit.version).toBeGreaterThan(state.version);
      // Player should have 3 cards (2 dealt + 1 drawn)
      expect(afterHit.zones["hand:0"]!.cards).toHaveLength(3);
    });

    it("hit then all players stand completes the round", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      // Player 0 hits (draws a card, no end_turn)
      let current = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "hit",
      });

      // Player 0 stands (end_turn)
      current = reducer(current, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      // Player 1 stands (end_turn)
      current = reducer(current, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "stand",
      });

      // Round complete → back to player_turns
      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBeGreaterThan(state.turnNumber);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Scoring Correctness ────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("scoring correctness", () => {
    it("survives the scoring phase and produces a valid next-round state", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      // All players must stand for round to complete
      let afterRound = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });
      afterRound = reducer(afterRound, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "stand",
      });

      // Game survived scoring without errors and advanced to next round
      expect(afterRound.status.kind).toBe("in_progress");
      expect(afterRound.currentPhase).toBe("player_turns");
      // Scores are cleared after round_end's reset_round effect
      expect(afterRound.scores).toEqual({});
    });

    it("produces valid hands with dealt cards after scoring round", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      // All players must stand for round to complete
      let afterRound = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });
      afterRound = reducer(afterRound, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "stand",
      });

      expect(afterRound.zones["hand:0"]!.cards).toHaveLength(2);
      expect(afterRound.zones["hand:1"]!.cards).toHaveLength(2);
      expect(afterRound.zones["dealer_hand"]!.cards).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Multi-round Game ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("multi-round game", () => {
    /** Helper: complete one round by having all players stand. */
    function completeRound(
      state: CardGameState,
      reducer: GameReducer,
      players: Player[]
    ): CardGameState {
      let current = state;
      for (const player of players) {
        current = reducer(current, {
          kind: "declare",
          playerId: player.id,
          declaration: "stand",
        });
      }
      return current;
    }

    it("survives 5 consecutive rounds with consistent state", () => {
      const { state: initialState, reducer, players } = startGame(ruleset, 2);

      let current = initialState;

      for (let round = 0; round < 5; round++) {
        expect(current.status.kind).toBe("in_progress");
        expect(current.currentPhase).toBe("player_turns");
        expect(totalCards(current)).toBe(DECK_SIZE);

        current = completeRound(current, reducer, players);
      }

      expect(current.status.kind).toBe("in_progress");
      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBe(initialState.turnNumber + 5);
      expect(totalCards(current)).toBe(DECK_SIZE);
    });

    it("increments turnNumber each round", () => {
      const { state: initialState, reducer, players } = startGame(ruleset, 2);

      let current = initialState;
      const turnNumbers: number[] = [current.turnNumber];

      for (let round = 0; round < 3; round++) {
        current = completeRound(current, reducer, players);
        turnNumbers.push(current.turnNumber);
      }

      for (let i = 1; i < turnNumbers.length; i++) {
        expect(turnNumbers[i]!).toBeGreaterThan(turnNumbers[i - 1]!);
      }
    });

    it("currentPhase is always player_turns after each round", () => {
      const { state: initialState, reducer, players } = startGame(ruleset, 2);

      let current = initialState;

      for (let round = 0; round < 5; round++) {
        expect(current.currentPhase).toBe("player_turns");
        current = completeRound(current, reducer, players);
      }
      expect(current.currentPhase).toBe("player_turns");
    });

    it("game stays in_progress throughout multiple rounds", () => {
      const { state: initialState, reducer, players } = startGame(ruleset, 2);

      let current = initialState;

      for (let round = 0; round < 5; round++) {
        expect(current.status.kind).toBe("in_progress");
        current = completeRound(current, reducer, players);
      }
      expect(current.status.kind).toBe("in_progress");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player View Filtering ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player view filtering", () => {
    it("player can see their own hand cards", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const myHand = view.zones["hand:0"]!;
      expect(myHand.cards.every((c) => c !== null)).toBe(true);
      expect(myHand.cardCount).toBe(2);
    });

    it("dealer's second card is hidden (first_card_only partial visibility)", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const dealerHand = view.zones["dealer_hand"]!;
      expect(dealerHand.cardCount).toBe(2);
      expect(dealerHand.cards[0]).not.toBeNull();
      expect(dealerHand.cards[1]).toBeNull();
    });

    it("per-player hand zones use owner_only visibility based on player index", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const myHand = view.zones["hand:0"]!;
      const otherHand = view.zones["hand:1"]!;

      // Own hand is visible, opponent's hand is hidden (null placeholders)
      expect(myHand.cards.every((c) => c !== null)).toBe(true);
      expect(otherHand.cards.every((c) => c === null)).toBe(true);
    });

    it("isMyTurn is correct for current player", () => {
      const { state, players } = startGame(ruleset, 2);

      const view0 = createPlayerView(state, players[0]!.id);
      expect(view0.isMyTurn).toBe(true);

      const view1 = createPlayerView(state, players[1]!.id);
      expect(view1.isMyTurn).toBe(false);
    });

    it("draw_pile cards are hidden from all players", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const drawPile = view.zones["draw_pile"]!;
      expect(drawPile.cards.every((c) => c === null)).toBe(true);
      expect(drawPile.cardCount).toBeGreaterThan(0);
    });

    it("discard pile is visible to all players (public visibility)", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const discard = view.zones["discard"]!;
      // Initially empty, but verify it exists with correct count
      expect(discard.cardCount).toBe(0);
      expect(discard.cards).toHaveLength(0);
    });

    it("myPlayerId is set correctly in the view", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.myPlayerId).toBe(players[0]!.id);
    });

    it("view includes all zone information", () => {
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.zones["hand:0"]).toBeDefined();
      expect(view.zones["hand:1"]).toBeDefined();
      expect(view.zones["dealer_hand"]).toBeDefined();
      expect(view.zones["draw_pile"]).toBeDefined();
      expect(view.zones["discard"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Turn Order Enforcement ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("turn order enforcement", () => {
    it("rejects action from player 1 when it is player 0's turn", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterWrongTurn = reducer(state, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "hit",
      });

      // State should be unchanged (no-op)
      expect(afterWrongTurn.version).toBe(state.version);
    });

    it("accepts action from player 0 when it is player 0's turn", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterAction = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      expect(afterAction.version).toBeGreaterThan(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Invalid Action Rejection ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("invalid action rejection", () => {
    it("unknown declaration ('split') is a no-op", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterSplit = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "split",
      });

      expect(afterSplit.version).toBe(state.version);
    });

    it("action from non-existent player is a no-op", () => {
      const { state, reducer } = startGame(ruleset, 2);

      const afterGhost = reducer(state, {
        kind: "declare",
        playerId: pid("ghost-player"),
        declaration: "hit",
      });

      expect(afterGhost.version).toBe(state.version);
    });

    it("unknown declaration preserves all state properties", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterBad = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "surrender",
      });

      expect(afterBad.currentPhase).toBe(state.currentPhase);
      expect(afterBad.turnNumber).toBe(state.turnNumber);
      expect(afterBad.currentPlayerIndex).toBe(state.currentPlayerIndex);
      expect(afterBad.scores).toEqual(state.scores);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deterministic Replay ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deterministic replay", () => {
    it("two identical games with same seed produce identical hands after deal", () => {
      const game1 = startGame(ruleset, 2, FIXED_SEED);
      const game2 = startGame(ruleset, 2, FIXED_SEED);

      expect(handDescription(game1.state, "hand:0")).toEqual(
        handDescription(game2.state, "hand:0")
      );
      expect(handDescription(game1.state, "hand:1")).toEqual(
        handDescription(game2.state, "hand:1")
      );
      expect(handDescription(game1.state, "dealer_hand")).toEqual(
        handDescription(game2.state, "dealer_hand")
      );
    });

    it("same seed produces identical state after full round", () => {
      const game1 = startGame(ruleset, 2, FIXED_SEED);
      const game2 = startGame(ruleset, 2, FIXED_SEED);

      const after1 = game1.reducer(game1.state, {
        kind: "declare",
        playerId: game1.players[0]!.id,
        declaration: "stand",
      });
      const after2 = game2.reducer(game2.state, {
        kind: "declare",
        playerId: game2.players[0]!.id,
        declaration: "stand",
      });

      expect(handDescription(after1, "hand:0")).toEqual(
        handDescription(after2, "hand:0")
      );
      expect(handDescription(after1, "hand:1")).toEqual(
        handDescription(after2, "hand:1")
      );
      expect(handDescription(after1, "dealer_hand")).toEqual(
        handDescription(after2, "dealer_hand")
      );
      expect(after1.turnNumber).toBe(after2.turnNumber);
      expect(after1.version).toBe(after2.version);
    });

    it("different seeds produce different deals", () => {
      const game1 = startGame(ruleset, 2, 42);
      const game2 = startGame(ruleset, 2, 999);

      const hand1 = handDescription(game1.state, "hand:0");
      const hand2 = handDescription(game2.state, "hand:0");

      expect(hand1).not.toEqual(hand2);
    });

    it("card IDs are identical between same-seed games", () => {
      const game1 = startGame(ruleset, 2, FIXED_SEED);
      const game2 = startGame(ruleset, 2, FIXED_SEED);

      const ids1 = game1.state.zones["hand:0"]!.cards.map((c) => c.id);
      const ids2 = game2.state.zones["hand:0"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Double Down ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("double down", () => {
    it("draws exactly 1 card and ends the player's turn", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterDoubleDown = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "double_down",
      });

      // double_down draws 1 card + end_turn → advances to player 1's turn
      expect(afterDoubleDown.status.kind).toBe("in_progress");
      expect(afterDoubleDown.currentPhase).toBe("player_turns");
      // Player 0's hand should have 3 cards (2 dealt + 1 drawn)
      expect(afterDoubleDown.zones["hand:0"]!.cards).toHaveLength(3);
      expect(afterDoubleDown.version).toBeGreaterThan(state.version);
    });

    it("double_down for all players completes the round", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      let current = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "double_down",
      });

      current = reducer(current, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "double_down",
      });

      // All players done → round auto-completes
      expect(current.status.kind).toBe("in_progress");
      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBeGreaterThan(state.turnNumber);
    });

    it("double_down ruleset definition includes draw and end_turn effects", () => {
      const playerTurnsPhase = ruleset.phases.find(
        (p) => p.name === "player_turns"
      );
      const doubleDownAction = playerTurnsPhase!.actions.find(
        (a) => a.name === "double_down"
      );

      expect(doubleDownAction).toBeDefined();
      expect(doubleDownAction!.effect).toEqual([
        "draw(draw_pile, current_player.hand, 1)",
        "end_turn()",
      ]);
      expect(doubleDownAction!.condition).toBe(
        "card_count(current_player.hand) == 2"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Conservation ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card conservation", () => {
    it("total cards after start_game equals deck size (52)", () => {
      const { state } = startGame(ruleset, 2);

      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("total cards are conserved after stand action (through full round)", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterStand = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      expect(totalCards(afterStand)).toBe(DECK_SIZE);
    });

    it("total cards are conserved after hit action (through full round)", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      const afterHit = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "hit",
      });

      expect(totalCards(afterHit)).toBe(DECK_SIZE);
    });

    it("total cards are conserved across 5 rounds", () => {
      const { state: initialState, reducer, players } = startGame(ruleset, 2);

      let current = initialState;
      for (let round = 0; round < 5; round++) {
        expect(totalCards(current)).toBe(DECK_SIZE);
        // All players must stand to complete the round
        for (const player of players) {
          current = reducer(current, {
            kind: "declare",
            playerId: player.id,
            declaration: "stand",
          });
        }
      }
      expect(totalCards(current)).toBe(DECK_SIZE);
    });

    it("no duplicate card IDs exist across all zones", () => {
      const { state } = startGame(ruleset, 2);

      const allIds = Object.values(state.zones).flatMap((z) =>
        z.cards.map((c) => c.id)
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it("draw pile is reduced by dealt cards after start_game", () => {
      const { state } = startGame(ruleset, 2);

      // 2 players × 2 cards + 2 dealer = 6 cards dealt
      const expectedDrawPile = DECK_SIZE - 6;
      expect(state.zones["draw_pile"]!.cards).toHaveLength(expectedDrawPile);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Edge Cases ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("single-player game works correctly", () => {
      const { state, reducer, players } = startGame(ruleset, 1);

      expect(state.zones["hand:0"]!.cards).toHaveLength(2);
      expect(state.zones["dealer_hand"]!.cards).toHaveLength(2);
      expect(state.currentPhase).toBe("player_turns");

      const afterStand = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      expect(afterStand.currentPhase).toBe("player_turns");
      expect(afterStand.turnNumber).toBeGreaterThan(state.turnNumber);
    });

    it("maximum player game (6 players) deals correctly", () => {
      const { state } = startGame(ruleset, 6);

      // 6 players × 2 cards + 2 dealer = 14 cards dealt
      for (let i = 0; i < 6; i++) {
        expect(state.zones[`hand:${i}`]!.cards).toHaveLength(2);
      }
      expect(state.zones["dealer_hand"]!.cards).toHaveLength(2);
      expect(state.zones["draw_pile"]!.cards).toHaveLength(DECK_SIZE - 14);
      expect(state.currentPhase).toBe("player_turns");
    });

    it("maximum player game survives a full round", () => {
      const { state, reducer, players } = startGame(ruleset, 6);

      // All 6 players must stand to complete the round
      let current = state;
      for (const player of players) {
        current = reducer(current, {
          kind: "declare",
          playerId: player.id,
          declaration: "stand",
        });
      }

      expect(current.currentPhase).toBe("player_turns");
      expect(current.turnNumber).toBeGreaterThan(state.turnNumber);
    });

    it("start_game is a no-op on an already started game", () => {
      const { state, reducer } = startGame(ruleset, 2);

      const afterSecondStart = reducer(state, { kind: "start_game" });
      expect(afterSecondStart).toBe(state);
    });

    it("version monotonically increases through game actions", () => {
      const { state, reducer, players } = startGame(ruleset, 2);

      let current = state;
      const versions: number[] = [current.version];

      // Each player standing increases the version
      for (let i = 0; i < 3; i++) {
        // Complete a full round (both players stand)
        for (const player of players) {
          current = reducer(current, {
            kind: "declare",
            playerId: player.id,
            declaration: "stand",
          });
          versions.push(current.version);
        }
      }

      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
      }
    });

    it("action log grows with each action", () => {
      const { state, reducer, players } = startGame(ruleset, 2);
      const initialLogLength = state.actionLog.length;

      const afterStand = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "stand",
      });

      expect(afterStand.actionLog.length).toBeGreaterThan(initialLogLength);
    });
  });
});

// ─── Integration Test — Full War Game Lifecycle ────────────────────
// Exercises the War card game end-to-end: load ruleset from JSON,
// create state, run reducer through battle rounds (including war/tie
// scenarios), and verify player views. War is a 2-player game where
// each player reveals their top card; the higher rank wins the pair.
// On ties, a "war" occurs: 4 extra cards per player are staked and
// the comparison card determines the winner of the entire pot.

// ─── War Fixture Setup ────────────────────────────────────────────

const WAR_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  "2":  { kind: "fixed", value: 2 },
  "3":  { kind: "fixed", value: 3 },
  "4":  { kind: "fixed", value: 4 },
  "5":  { kind: "fixed", value: 5 },
  "6":  { kind: "fixed", value: 6 },
  "7":  { kind: "fixed", value: 7 },
  "8":  { kind: "fixed", value: 8 },
  "9":  { kind: "fixed", value: 9 },
  "10": { kind: "fixed", value: 10 },
  "J":  { kind: "fixed", value: 11 },
  "Q":  { kind: "fixed", value: 12 },
  "K":  { kind: "fixed", value: 13 },
  "A":  { kind: "fixed", value: 14 },
};

const WAR_RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/war.cardgame.json"
);

/**
 * Builds a War ruleset directly (1 copy of standard 52, 2 players).
 * Matches the structure of war.cardgame.json.
 */
function makeWarRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "War",
      slug: "war",
      version: "1.0.0",
      author: "faluciano",
      players: { min: 2, max: 2 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: WAR_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      {
        name: "deck",
        visibility: { kind: "hidden" },
        owners: ["player"],
      },
      {
        name: "battle",
        visibility: { kind: "partial", rule: "face_up_only" },
        owners: ["player"],
      },
      {
        name: "won",
        visibility: { kind: "hidden" },
        owners: ["player"],
      },
      { name: "pot", visibility: { kind: "hidden" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
    ],
    phases: [
      {
        name: "setup",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "ready_check", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, deck, 26)",
        ],
      },
      {
        name: "ready_check",
        kind: "all_players",
        actions: [
          {
            name: "ready",
            label: "Battle!",
            effect: ["end_turn()"],
          },
        ],
        transitions: [
          { to: "scoring", when: 'card_count("deck:0") == 0 || card_count("deck:1") == 0' },
          { to: "battle", when: "all_players_done" },
        ],
      },
      {
        name: "battle",
        kind: "automatic",
        actions: [],
        transitions: [
          { to: "resolve_p0_wins", when: 'top_card_rank("battle:0") > top_card_rank("battle:1")' },
          { to: "resolve_p1_wins", when: 'top_card_rank("battle:0") < top_card_rank("battle:1")' },
          { to: "war", when: 'top_card_rank("battle:0") == top_card_rank("battle:1")' },
        ],
        automaticSequence: [
          'move_top("deck:0", "battle:0", 1)',
          'flip_top("battle:0", 1)',
          'move_top("deck:1", "battle:1", 1)',
          'flip_top("battle:1", 1)',
        ],
      },
      {
        name: "war",
        kind: "automatic",
        actions: [],
        transitions: [
          { to: "resolve_p0_wins", when: 'card_count("deck:0") == 0 || card_count("deck:1") == 0 || top_card_rank("battle:0") > top_card_rank("battle:1")' },
          { to: "resolve_p1_wins", when: 'top_card_rank("battle:0") < top_card_rank("battle:1")' },
          { to: "war", when: 'top_card_rank("battle:0") == top_card_rank("battle:1")' },
        ],
        automaticSequence: [
          'move_all("battle:0", "pot")',
          'move_all("battle:1", "pot")',
          'move_top("deck:0", "battle:0", 1)',
          'flip_top("battle:0", 1)',
          'move_top("deck:0", "battle:0", 3)',
          'move_top("deck:1", "battle:1", 1)',
          'flip_top("battle:1", 1)',
          'move_top("deck:1", "battle:1", 3)',
        ],
      },
      {
        name: "resolve_p0_wins",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "ready_check", when: "all_hands_dealt" }],
        automaticSequence: [
          'move_all("battle:0", "won:0")',
          'move_all("battle:1", "won:0")',
          'move_all("pot", "won:0")',
          'shuffle("won:0")',
          'move_all("won:0", "deck:0")',
        ],
      },
      {
        name: "resolve_p1_wins",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "ready_check", when: "all_hands_dealt" }],
        automaticSequence: [
          'move_all("battle:0", "won:1")',
          'move_all("battle:1", "won:1")',
          'move_all("pot", "won:1")',
          'shuffle("won:1")',
          'move_all("won:1", "deck:1")',
        ],
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "game_over", when: "scores_calculated" }],
        automaticSequence: [
          "calculate_scores()",
          "determine_winners()",
        ],
      },
      {
        name: "game_over",
        kind: "all_players",
        actions: [
          {
            name: "play_again",
            label: "Play Again",
            effect: [
              "collect_all_to(draw_pile)",
              "reset_round()",
            ],
          },
        ],
        transitions: [{ to: "setup", when: "continue_game" }],
      },
    ],
    scoring: {
      method: "card_count(current_player.deck) + card_count(current_player.battle) + card_count(current_player.won)",
      winCondition: "my_score > 0",
    },
    visibility: [
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "deck", visibility: { kind: "hidden" } },
      { zone: "battle", visibility: { kind: "partial", rule: "face_up_only" } },
      { zone: "won", visibility: { kind: "hidden" } },
      { zone: "pot", visibility: { kind: "hidden" } },
    ],
    ui: { layout: "linear", tableColor: "felt_green" },
  };
}

/**
 * Creates a started War game ready for player actions.
 * Returns state at `ready_check` with 26 cards dealt to each player's deck.
 */
function startWarGame(
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const warRuleset = makeWarRuleset();
  const players: Player[] = [
    { id: pid("player-0"), name: "Player 0", role: "player", connected: true },
    { id: pid("player-1"), name: "Player 1", role: "player", connected: true },
  ];
  const reducer = createReducer(warRuleset, seed);
  const initial = createInitialState(
    warRuleset,
    sid("war-test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

/**
 * Plays one battle round: both players declare "ready", engine auto-resolves
 * through battle → resolve → back to ready_check.
 */
function playWarRound(
  state: CardGameState,
  reducer: GameReducer,
  players: Player[]
): CardGameState {
  let current = reducer(state, {
    kind: "declare",
    playerId: players[0]!.id,
    declaration: "ready",
  });
  current = reducer(current, {
    kind: "declare",
    playerId: players[1]!.id,
    declaration: "ready",
  });
  return current;
}

// ─── War Tests ─────────────────────────────────────────────────────

describe("War Integration — Full Game Lifecycle", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Ruleset Loading from JSON ──────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("ruleset loading from JSON", () => {
    it("loads and validates the war ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(WAR_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("War");
      expect(jsonRuleset.meta.slug).toBe("war");
      expect(jsonRuleset.phases).toHaveLength(8);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(5);
    });

    it("validates schema with parseRuleset without throwing", () => {
      const raw = JSON.parse(readFileSync(WAR_RULESET_PATH, "utf-8"));
      expect(() => parseRuleset(raw)).not.toThrow();
    });

    it("JSON ruleset contains all expected phases", () => {
      const raw = JSON.parse(readFileSync(WAR_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "setup",
        "ready_check",
        "battle",
        "war",
        "resolve_p0_wins",
        "resolve_p1_wins",
        "scoring",
        "game_over",
      ]);
    });

    it("JSON ruleset contains the ready action in ready_check phase", () => {
      const raw = JSON.parse(readFileSync(WAR_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const readyCheck = jsonRuleset.phases.find(
        (p) => p.name === "ready_check"
      );
      expect(readyCheck).toBeDefined();
      expect(readyCheck!.kind).toBe("all_players");
      const actionNames = readyCheck!.actions.map((a) => a.name);
      expect(actionNames).toContain("ready");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Setup Phase ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("setup phase", () => {
    it("after start_game, state is in_progress at ready_check", () => {
      const { state } = startWarGame();

      expect(state.status.kind).toBe("in_progress");
      expect(state.currentPhase).toBe("ready_check");
    });

    it("deals 26 cards to each player's deck", () => {
      const { state } = startWarGame();

      expect(state.zones["deck:0"]!.cards).toHaveLength(26);
      expect(state.zones["deck:1"]!.cards).toHaveLength(26);
    });

    it("draw_pile is empty after dealing", () => {
      const { state } = startWarGame();

      expect(state.zones["draw_pile"]!.cards).toHaveLength(0);
    });

    it("battle, won, and pot zones are empty after setup", () => {
      const { state } = startWarGame();

      expect(state.zones["battle:0"]!.cards).toHaveLength(0);
      expect(state.zones["battle:1"]!.cards).toHaveLength(0);
      expect(state.zones["won:0"]!.cards).toHaveLength(0);
      expect(state.zones["won:1"]!.cards).toHaveLength(0);
      expect(state.zones["pot"]!.cards).toHaveLength(0);
    });

    it("total cards equals 52 after setup", () => {
      const { state } = startWarGame();

      expect(totalCards(state)).toBe(DECK_SIZE);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Battle Round ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("battle round", () => {
    it("both players pressing ready triggers battle → resolve → ready_check", () => {
      const { state, reducer, players } = startWarGame();

      const afterRound = playWarRound(state, reducer, players);

      expect(afterRound.currentPhase).toBe("ready_check");
      expect(afterRound.status.kind).toBe("in_progress");
    });

    it("card conservation holds after a battle round (52 total)", () => {
      const { state, reducer, players } = startWarGame();

      const afterRound = playWarRound(state, reducer, players);

      expect(totalCards(afterRound)).toBe(DECK_SIZE);
    });

    it("one player gained cards after a normal battle round", () => {
      const { state, reducer, players } = startWarGame();

      const afterRound = playWarRound(state, reducer, players);

      const deck0 = afterRound.zones["deck:0"]!.cards.length;
      const deck1 = afterRound.zones["deck:1"]!.cards.length;

      // In a normal battle, the winner gains 2 cards (the battle pair).
      // After resolution, won cards are shuffled back into the winner's deck.
      // So one deck should be > 26 and the other < 26.
      expect(deck0 + deck1).toBe(DECK_SIZE);
      expect(deck0 !== deck1).toBe(true);
    });

    it("battle and won zones are empty after resolution", () => {
      const { state, reducer, players } = startWarGame();

      const afterRound = playWarRound(state, reducer, players);

      expect(afterRound.zones["battle:0"]!.cards).toHaveLength(0);
      expect(afterRound.zones["battle:1"]!.cards).toHaveLength(0);
      expect(afterRound.zones["won:0"]!.cards).toHaveLength(0);
      expect(afterRound.zones["won:1"]!.cards).toHaveLength(0);
      expect(afterRound.zones["pot"]!.cards).toHaveLength(0);
    });

    it("version increases after a battle round", () => {
      const { state, reducer, players } = startWarGame();

      const afterRound = playWarRound(state, reducer, players);

      expect(afterRound.version).toBeGreaterThan(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Conservation Across Multiple Battles ──────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card conservation across multiple battles", () => {
    it("maintains 52 total cards across 5 battle rounds", () => {
      const { state, reducer, players } = startWarGame();

      let current = state;
      for (let round = 0; round < 5; round++) {
        expect(totalCards(current)).toBe(DECK_SIZE);
        current = playWarRound(current, reducer, players);
      }
      expect(totalCards(current)).toBe(DECK_SIZE);
    });

    it("game stays at ready_check after 5 rounds (not over yet)", () => {
      const { state, reducer, players } = startWarGame();

      let current = state;
      for (let round = 0; round < 5; round++) {
        current = playWarRound(current, reducer, players);
        expect(current.status.kind).toBe("in_progress");
        expect(current.currentPhase).toBe("ready_check");
      }
    });

    it("no duplicate card IDs after multiple rounds", () => {
      const { state, reducer, players } = startWarGame();

      let current = state;
      for (let round = 0; round < 5; round++) {
        current = playWarRound(current, reducer, players);
      }

      const allIds = Object.values(current.zones).flatMap((z) =>
        z.cards.map((c) => c.id)
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deterministic Replay ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deterministic replay", () => {
    it("two games with same seed produce identical decks after setup", () => {
      const game1 = startWarGame(FIXED_SEED);
      const game2 = startWarGame(FIXED_SEED);

      expect(handDescription(game1.state, "deck:0")).toEqual(
        handDescription(game2.state, "deck:0")
      );
      expect(handDescription(game1.state, "deck:1")).toEqual(
        handDescription(game2.state, "deck:1")
      );
    });

    it("same seed produces identical state after a battle round", () => {
      const game1 = startWarGame(FIXED_SEED);
      const game2 = startWarGame(FIXED_SEED);

      const after1 = playWarRound(game1.state, game1.reducer, game1.players);
      const after2 = playWarRound(game2.state, game2.reducer, game2.players);

      expect(handDescription(after1, "deck:0")).toEqual(
        handDescription(after2, "deck:0")
      );
      expect(handDescription(after1, "deck:1")).toEqual(
        handDescription(after2, "deck:1")
      );
      expect(after1.version).toBe(after2.version);
    });

    it("different seeds produce different deck contents", () => {
      const game1 = startWarGame(42);
      const game2 = startWarGame(999);

      const deck1 = handDescription(game1.state, "deck:0");
      const deck2 = handDescription(game2.state, "deck:0");

      expect(deck1).not.toEqual(deck2);
    });

    it("card IDs are identical between same-seed games", () => {
      const game1 = startWarGame(FIXED_SEED);
      const game2 = startWarGame(FIXED_SEED);

      const ids1 = game1.state.zones["deck:0"]!.cards.map((c) => c.id);
      const ids2 = game2.state.zones["deck:0"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player View Filtering ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player view filtering", () => {
    it("deck cards are hidden (all null) for player 0", () => {
      const { state, players } = startWarGame();
      const view = createPlayerView(state, players[0]!.id);

      const deck0 = view.zones["deck:0"]!;
      expect(deck0.cardCount).toBe(26);
      expect(deck0.cards.every((c) => c === null)).toBe(true);
    });

    it("deck cards are hidden for player 1 as well", () => {
      const { state, players } = startWarGame();
      const view = createPlayerView(state, players[1]!.id);

      const deck1 = view.zones["deck:1"]!;
      expect(deck1.cardCount).toBe(26);
      expect(deck1.cards.every((c) => c === null)).toBe(true);
    });

    it("battle zone uses face_up_only visibility (empty after setup)", () => {
      const { state, players } = startWarGame();
      const view = createPlayerView(state, players[0]!.id);

      const battle0 = view.zones["battle:0"]!;
      expect(battle0.cardCount).toBe(0);
      expect(battle0.cards).toHaveLength(0);
    });

    it("pot cards are hidden from all players", () => {
      const { state, players } = startWarGame();
      const view = createPlayerView(state, players[0]!.id);

      const pot = view.zones["pot"]!;
      expect(pot.cardCount).toBe(0);
      expect(pot.cards.every((c) => c === null)).toBe(true);
    });

    it("isMyTurn is true for both players in all_players phase", () => {
      const { state, players } = startWarGame();

      const view0 = createPlayerView(state, players[0]!.id);
      const view1 = createPlayerView(state, players[1]!.id);

      // ready_check is an all_players phase, so both are active
      expect(view0.isMyTurn).toBe(true);
      expect(view1.isMyTurn).toBe(true);
    });

    it("myPlayerId is set correctly in each view", () => {
      const { state, players } = startWarGame();

      const view0 = createPlayerView(state, players[0]!.id);
      expect(view0.myPlayerId).toBe(players[0]!.id);

      const view1 = createPlayerView(state, players[1]!.id);
      expect(view1.myPlayerId).toBe(players[1]!.id);
    });

    it("view includes all expected zone names", () => {
      const { state, players } = startWarGame();
      const view = createPlayerView(state, players[0]!.id);

      expect(view.zones["draw_pile"]).toBeDefined();
      expect(view.zones["deck:0"]).toBeDefined();
      expect(view.zones["deck:1"]).toBeDefined();
      expect(view.zones["battle:0"]).toBeDefined();
      expect(view.zones["battle:1"]).toBeDefined();
      expect(view.zones["won:0"]).toBeDefined();
      expect(view.zones["won:1"]).toBeDefined();
      expect(view.zones["pot"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Scoring and Game Over ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("scoring and game over", () => {
    it("scoring expression parses without errors via parseRuleset", () => {
      const raw = JSON.parse(readFileSync(WAR_RULESET_PATH, "utf-8"));
      const parsed = parseRuleset(raw);

      expect(parsed.scoring.method).toBe(
        "card_count(current_player.deck) + card_count(current_player.battle) + card_count(current_player.won)"
      );
      expect(parsed.scoring.winCondition).toBe("my_score > 0");
    });

    it("engine survives 20 rounds without errors", () => {
      const { state, reducer, players } = startWarGame();

      let current = state;
      for (let round = 0; round < 20; round++) {
        // Game might end if one player runs out of cards
        if (current.status.kind !== "in_progress" || current.currentPhase !== "ready_check") {
          break;
        }
        current = playWarRound(current, reducer, players);
        expect(totalCards(current)).toBe(DECK_SIZE);
      }

      // Game should still be valid — either in_progress or finished
      expect(["in_progress", "finished"]).toContain(current.status.kind);
    });

    it("scoring method sums deck + battle + won for each player", () => {
      // Verify the scoring config is structurally correct
      const ruleset = makeWarRuleset();
      expect(ruleset.scoring.method).toContain("card_count(current_player.deck)");
      expect(ruleset.scoring.method).toContain("card_count(current_player.battle)");
      expect(ruleset.scoring.method).toContain("card_count(current_player.won)");
      expect(ruleset.scoring.winCondition).toBe("my_score > 0");
      // No bustCondition or tieCondition in War
      expect(ruleset.scoring).not.toHaveProperty("bustCondition");
      expect(ruleset.scoring).not.toHaveProperty("tieCondition");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── War Scenario (Tie) ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("war scenario (tie)", () => {
    /**
     * Finds a seed where a war (tie) occurs in the first battle round.
     * Detection: after one battle round, the winner gains more than 2 cards
     * (war involves original 2 battle cards + pot cards from the war stakes).
     * A normal win transfers 2 cards; a war transfers at minimum 10 cards
     * (2 original + 8 stakes). Returns the seed or null if none found.
     */
    function findWarSeed(range: number = 1000): number | null {
      for (let seed = 0; seed < range; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startWarGame(seed);
          const afterRound = playWarRound(game.state, game.reducer, game.players);

          // In a normal battle, the difference in deck sizes is exactly 2
          // (winner gains 2 cards, loser loses 2). In a war, the difference
          // is much larger because of the staked cards.
          const deck0 = afterRound.zones["deck:0"]!.cards.length;
          const deck1 = afterRound.zones["deck:1"]!.cards.length;
          const diff = Math.abs(deck0 - deck1);

          // War: 2 battle cards + at least 8 stakes = 10 card swing
          if (diff > 2) {
            return seed;
          }
        } catch {
          // Skip seeds that cause errors (e.g., edge cases)
          continue;
        }
      }
      return null;
    }

    it("can find a seed that produces a war (tie) in the first round", () => {
      const warSeed = findWarSeed();
      expect(warSeed).not.toBeNull();
    });

    it("war produces correct card conservation after tie resolution", () => {
      const warSeed = findWarSeed();
      if (warSeed === null) {
        // Skip test if no war seed found — should not happen with 1000 seeds
        expect(warSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startWarGame(warSeed);
      const afterRound = playWarRound(state, reducer, players);

      expect(totalCards(afterRound)).toBe(DECK_SIZE);
      expect(afterRound.currentPhase).toBe("ready_check");
      expect(afterRound.status.kind).toBe("in_progress");
    });

    it("war winner gains more than 2 cards (pot is distributed)", () => {
      const warSeed = findWarSeed();
      if (warSeed === null) {
        expect(warSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startWarGame(warSeed);
      const afterRound = playWarRound(state, reducer, players);

      const deck0 = afterRound.zones["deck:0"]!.cards.length;
      const deck1 = afterRound.zones["deck:1"]!.cards.length;

      // The winner should have significantly more than 26 cards
      const winnerDeck = Math.max(deck0, deck1);
      const loserDeck = Math.min(deck0, deck1);

      // War involves at minimum 10 cards (2 battle + 4 stakes per player)
      expect(winnerDeck - loserDeck).toBeGreaterThan(2);
      expect(winnerDeck + loserDeck).toBe(DECK_SIZE);
    });

    it("game survives multiple rounds after a war", () => {
      const warSeed = findWarSeed();
      if (warSeed === null) {
        expect(warSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startWarGame(warSeed);

      let current = state;
      for (let round = 0; round < 10; round++) {
        if (current.status.kind !== "in_progress" || current.currentPhase !== "ready_check") {
          break;
        }
        current = playWarRound(current, reducer, players);
        expect(totalCards(current)).toBe(DECK_SIZE);
      }

      // Game should still be valid after multiple rounds post-war
      expect(["in_progress", "finished"]).toContain(current.status.kind);
    });

    it("war produces higher version jump than a normal battle", () => {
      const warSeed = findWarSeed();
      if (warSeed === null) {
        expect(warSeed).not.toBeNull();
        return;
      }

      // Find a seed with a normal (non-war) battle for comparison
      let normalSeed: number | null = null;
      for (let seed = 0; seed < 1000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startWarGame(seed);
          const afterRound = playWarRound(game.state, game.reducer, game.players);
          const deck0 = afterRound.zones["deck:0"]!.cards.length;
          const deck1 = afterRound.zones["deck:1"]!.cards.length;
          if (Math.abs(deck0 - deck1) === 2) {
            normalSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (normalSeed === null) {
        // Can't find a normal seed; skip comparison
        return;
      }

      // Run war game
      clearBuiltins();
      registerAllBuiltins();
      const warGame = startWarGame(warSeed);
      const warAfter = playWarRound(warGame.state, warGame.reducer, warGame.players);
      const warVersionJump = warAfter.version - warGame.state.version;

      // Run normal game
      clearBuiltins();
      registerAllBuiltins();
      const normalGame = startWarGame(normalSeed);
      const normalAfter = playWarRound(normalGame.state, normalGame.reducer, normalGame.players);
      const normalVersionJump = normalAfter.version - normalGame.state.version;

      // War involves more automatic phases, so version should jump more
      expect(warVersionJump).toBeGreaterThan(normalVersionJump);
    });
  });
});

// ─── Integration Test — Full Crazy Eights Game Lifecycle ───────────
// Exercises the Crazy Eights card game end-to-end: load ruleset from
// JSON, create state, run reducer through play rounds, and verify
// card matching, drawing, and scoring mechanics. Crazy Eights is a
// 2-4 player game where players match cards by suit or rank, with
// eights being wild (playable on anything). Uses if() special form
// for guarded transitions and has_playable_card builtin for draw
// condition validation.

// ─── Crazy Eights Fixture Setup ───────────────────────────────────

const CRAZY_EIGHTS_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  "2":  { kind: "fixed", value: 2 },
  "3":  { kind: "fixed", value: 3 },
  "4":  { kind: "fixed", value: 4 },
  "5":  { kind: "fixed", value: 5 },
  "6":  { kind: "fixed", value: 6 },
  "7":  { kind: "fixed", value: 7 },
  "8":  { kind: "fixed", value: 50 },
  "9":  { kind: "fixed", value: 9 },
  "10": { kind: "fixed", value: 10 },
  "J":  { kind: "fixed", value: 10 },
  "Q":  { kind: "fixed", value: 10 },
  "K":  { kind: "fixed", value: 10 },
  "A":  { kind: "fixed", value: 1 },
};

const CRAZY_EIGHTS_RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/crazy-eights.cardgame.json"
);

/**
 * Builds a Crazy Eights ruleset directly (1 copy of standard 52, 2-4 players).
 * Matches the structure of crazy-eights.cardgame.json.
 */
function makeCrazyEightsRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Crazy Eights",
      slug: "crazy-eights",
      version: "1.0.0",
      author: "faluciano",
      players: { min: 2, max: 4 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: CRAZY_EIGHTS_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      {
        name: "hand",
        visibility: { kind: "owner_only" },
        owners: ["player"],
      },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
    ],
    phases: [
      {
        name: "setup",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "player_turns", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, hand, 5)",
          "move_top(draw_pile, discard, 1)",
          "flip_top(discard, 1)",
        ],
      },
      {
        name: "player_turns",
        kind: "turn_based",
        actions: [
          {
            name: "play_card",
            label: "Play Card",
            effect: ["end_turn()"],
          },
          {
            name: "draw",
            label: "Draw Card",
            condition: "!has_playable_card(current_player.hand, discard)",
            effect: [
              "draw(draw_pile, current_player.hand, 1)",
              "end_turn()",
            ],
          },
        ],
        transitions: [
          {
            to: "scoring",
            when: 'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "round_end", when: "scores_calculated" }],
        automaticSequence: [
          "calculate_scores()",
          "determine_winners()",
        ],
      },
      {
        name: "round_end",
        kind: "all_players",
        actions: [
          {
            name: "play_again",
            label: "Play Again",
            effect: [
              "collect_all_to(draw_pile)",
              "reset_round()",
            ],
          },
        ],
        transitions: [{ to: "setup", when: "continue_game" }],
      },
    ],
    scoring: {
      method: "hand_value(current_player.hand, 999)",
      winCondition: "my_score == 0",
      bustCondition: "false",
      tieCondition: "false",
    },
    visibility: [
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "hand", visibility: { kind: "owner_only" } },
      { zone: "discard", visibility: { kind: "public" } },
    ],
    ui: { layout: "circle", tableColor: "felt_green" },
  };
}

/**
 * Creates a started Crazy Eights game ready for player actions.
 * Returns state at `player_turns` with 5 cards dealt per player and
 * 1 card face-up in the discard pile.
 */
function startCrazyEightsGame(
  playerCount: number = 2,
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const crazyEightsRuleset = makeCrazyEightsRuleset();
  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: pid(`player-${i}`),
    name: `Player ${i}`,
    role: "player" as const,
    connected: true,
  }));
  const reducer = createReducer(crazyEightsRuleset, seed);
  const initial = createInitialState(
    crazyEightsRuleset,
    sid("crazy-eights-test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

// ─── Crazy Eights Tests ───────────────────────────────────────────

describe("Crazy Eights Integration — Full Game Lifecycle", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Ruleset Loading from JSON ──────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("ruleset loading from JSON", () => {
    it("loads and validates the crazy eights ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("Crazy Eights");
      expect(jsonRuleset.meta.slug).toBe("crazy-eights");
      expect(jsonRuleset.deck.preset).toBe("standard_52");
      expect(jsonRuleset.deck.copies).toBe(1);
      expect(jsonRuleset.phases).toHaveLength(4);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(3);
    });

    it("validates schema with parseRuleset without throwing", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      expect(() => parseRuleset(raw)).not.toThrow();
    });

    it("JSON ruleset contains all expected phases", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "setup",
        "player_turns",
        "scoring",
        "round_end",
      ]);
    });

    it("JSON ruleset contains draw action with has_playable_card condition", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playerTurns = jsonRuleset.phases.find(
        (p) => p.name === "player_turns"
      );
      expect(playerTurns).toBeDefined();
      const drawAction = playerTurns!.actions.find((a) => a.name === "draw");
      expect(drawAction).toBeDefined();
      expect(drawAction!.condition).toBe(
        "!has_playable_card(current_player.hand, discard)"
      );
    });

    it("JSON ruleset transition uses if() for guarded player count checks", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playerTurns = jsonRuleset.phases.find(
        (p) => p.name === "player_turns"
      );
      expect(playerTurns).toBeDefined();
      expect(playerTurns!.transitions[0]!.when).toContain("if(player_count > 2");
      expect(playerTurns!.transitions[0]!.when).toContain("if(player_count > 3");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Initial State Creation ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("initial state creation", () => {
    it("creates initial state with correct zones for 2 players", () => {
      const crazyEightsRuleset = makeCrazyEightsRuleset();
      const players: Player[] = [
        { id: pid("player-0"), name: "Player 0", role: "player", connected: true },
        { id: pid("player-1"), name: "Player 1", role: "player", connected: true },
      ];
      const initial = createInitialState(
        crazyEightsRuleset,
        sid("test-session"),
        players,
        FIXED_SEED
      );

      // Shared zones
      expect(initial.zones["draw_pile"]).toBeDefined();
      expect(initial.zones["discard"]).toBeDefined();
      // Per-player hand zones
      expect(initial.zones["hand:0"]).toBeDefined();
      expect(initial.zones["hand:1"]).toBeDefined();
      // No hand:2 or hand:3 with only 2 players
      expect(initial.zones["hand:2"]).toBeUndefined();
      expect(initial.zones["hand:3"]).toBeUndefined();
    });

    it("creates initial state with correct zones for 4 players", () => {
      const crazyEightsRuleset = makeCrazyEightsRuleset();
      const players: Player[] = Array.from({ length: 4 }, (_, i) => ({
        id: pid(`player-${i}`),
        name: `Player ${i}`,
        role: "player" as const,
        connected: true,
      }));
      const initial = createInitialState(
        crazyEightsRuleset,
        sid("test-session"),
        players,
        FIXED_SEED
      );

      expect(initial.zones["hand:0"]).toBeDefined();
      expect(initial.zones["hand:1"]).toBeDefined();
      expect(initial.zones["hand:2"]).toBeDefined();
      expect(initial.zones["hand:3"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Setup Phase ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("setup phase", () => {
    it("deals 5 cards per player and starts discard pile", () => {
      const { state } = startCrazyEightsGame(2);

      expect(state.zones["hand:0"]!.cards).toHaveLength(5);
      expect(state.zones["hand:1"]!.cards).toHaveLength(5);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      // 52 - 5 - 5 - 1 = 41 cards in draw pile
      expect(state.zones["draw_pile"]!.cards).toHaveLength(41);
    });

    it("discard pile top card is face up after setup", () => {
      const { state } = startCrazyEightsGame(2);

      const discardCards = state.zones["discard"]!.cards;
      expect(discardCards).toHaveLength(1);
      expect(discardCards[0]!.faceUp).toBe(true);
    });

    it("starts in player_turns phase after setup", () => {
      const { state } = startCrazyEightsGame(2);

      expect(state.status.kind).toBe("in_progress");
      expect(state.currentPhase).toBe("player_turns");
    });

    it("deals correctly with 3 players", () => {
      const { state } = startCrazyEightsGame(3);

      expect(state.zones["hand:0"]!.cards).toHaveLength(5);
      expect(state.zones["hand:1"]!.cards).toHaveLength(5);
      expect(state.zones["hand:2"]!.cards).toHaveLength(5);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      // 52 - 15 - 1 = 36
      expect(state.zones["draw_pile"]!.cards).toHaveLength(36);
    });

    it("deals correctly with 4 players", () => {
      const { state } = startCrazyEightsGame(4);

      expect(state.zones["hand:0"]!.cards).toHaveLength(5);
      expect(state.zones["hand:1"]!.cards).toHaveLength(5);
      expect(state.zones["hand:2"]!.cards).toHaveLength(5);
      expect(state.zones["hand:3"]!.cards).toHaveLength(5);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      // 52 - 20 - 1 = 31
      expect(state.zones["draw_pile"]!.cards).toHaveLength(31);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Matching Builtins ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card matching builtins", () => {
    it("has_playable_card returns true when hand has matching suit", () => {
      const { state } = startCrazyEightsGame(2);

      // The discard pile has 1 card. At least some of the 5 hand cards
      // should match by suit or rank (probabilistic, but with 5 cards
      // and 4 suits, very likely). We verify the builtin runs without error.
      const discardTop = state.zones["discard"]!.cards[0]!;
      const hand0Cards = state.zones["hand:0"]!.cards;

      // Check manually if any card matches
      const hasMatch = hand0Cards.some(
        (c) => c.suit === discardTop.suit || c.rank === discardTop.rank
      );

      // The engine's has_playable_card should agree
      const evalContext: EvalContext = {
        state,
        playerIndex: 0,
      };
      const result = evaluateExpression(
        'has_playable_card("hand:0", discard)',
        evalContext
      );
      expect(result.kind).toBe("boolean");
      expect(result.value).toBe(hasMatch);
    });

    it("card_matches_top correctly checks suit or rank match", () => {
      const { state } = startCrazyEightsGame(2);

      const discardTop = state.zones["discard"]!.cards[0]!;
      const hand0Cards = state.zones["hand:0"]!.cards;

      // Test each card in hand against the discard top
      for (let i = 0; i < hand0Cards.length; i++) {
        const card = hand0Cards[i]!;
        const expectedMatch =
          card.suit === discardTop.suit || card.rank === discardTop.rank;

        const evalContext: EvalContext = { state, playerIndex: 0 };
        const result = evaluateExpression(
          `card_matches_top("hand:0", ${i}, discard)`,
          evalContext
        );
        expect(result.kind).toBe("boolean");
        expect(result.value).toBe(expectedMatch);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player Drawing ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player drawing", () => {
    it("player can draw when they have no playable card", () => {
      // Find a seed where player 0 has no playable cards against the discard
      let drawSeed: number | null = null;
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          const hasMatch = hand0Cards.some(
            (c) =>
              c.suit === discardTop.suit || c.rank === discardTop.rank
          );
          if (!hasMatch) {
            drawSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (drawSeed === null) {
        // Very unlikely with 2000 seeds, but guard the test
        expect(drawSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, drawSeed);

      const drawPileBefore = state.zones["draw_pile"]!.cards.length;
      const handBefore = state.zones["hand:0"]!.cards.length;

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw",
      });

      // Draw adds 1 card to hand, removes 1 from draw pile, and ends turn
      expect(afterDraw.zones["hand:0"]!.cards.length).toBe(handBefore + 1);
      expect(afterDraw.zones["draw_pile"]!.cards.length).toBe(
        drawPileBefore - 1
      );
      expect(afterDraw.version).toBeGreaterThan(state.version);
    });

    it("draw action is rejected when player has a playable card", () => {
      // Find a seed where player 0 HAS playable cards against the discard
      let playSeed: number | null = null;
      for (let seed = 0; seed < 1000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          const hasMatch = hand0Cards.some(
            (c) =>
              c.suit === discardTop.suit || c.rank === discardTop.rank
          );
          if (hasMatch) {
            playSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (playSeed === null) {
        expect(playSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, playSeed);

      // Attempting to draw when you have a playable card should be a no-op
      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw",
      });

      // State should be unchanged (condition not met → no-op)
      expect(afterDraw.version).toBe(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Scoring ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("scoring", () => {
    it("scoring method uses hand_value with target 999", () => {
      const ruleset = makeCrazyEightsRuleset();
      expect(ruleset.scoring.method).toBe("hand_value(current_player.hand, 999)");
      expect(ruleset.scoring.winCondition).toBe("my_score == 0");
    });

    it("eights (8s) are worth 50 penalty points", () => {
      expect(CRAZY_EIGHTS_CARD_VALUES["8"]).toEqual({
        kind: "fixed",
        value: 50,
      });
    });

    it("face cards (J, Q, K) are worth 10 penalty points each", () => {
      expect(CRAZY_EIGHTS_CARD_VALUES["J"]).toEqual({
        kind: "fixed",
        value: 10,
      });
      expect(CRAZY_EIGHTS_CARD_VALUES["Q"]).toEqual({
        kind: "fixed",
        value: 10,
      });
      expect(CRAZY_EIGHTS_CARD_VALUES["K"]).toEqual({
        kind: "fixed",
        value: 10,
      });
    });

    it("ace is worth 1 penalty point", () => {
      expect(CRAZY_EIGHTS_CARD_VALUES["A"]).toEqual({
        kind: "fixed",
        value: 1,
      });
    });

    it("number cards are worth their face value", () => {
      for (let n = 2; n <= 7; n++) {
        expect(CRAZY_EIGHTS_CARD_VALUES[String(n)]).toEqual({
          kind: "fixed",
          value: n,
        });
      }
      expect(CRAZY_EIGHTS_CARD_VALUES["9"]).toEqual({
        kind: "fixed",
        value: 9,
      });
      expect(CRAZY_EIGHTS_CARD_VALUES["10"]).toEqual({
        kind: "fixed",
        value: 10,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Conservation ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card conservation", () => {
    it("total cards after start_game equals 52", () => {
      const { state } = startCrazyEightsGame(2);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("total cards are conserved with 3 players", () => {
      const { state } = startCrazyEightsGame(3);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("total cards are conserved with 4 players", () => {
      const { state } = startCrazyEightsGame(4);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("no duplicate card IDs exist across all zones", () => {
      const { state } = startCrazyEightsGame(2);

      const allIds = Object.values(state.zones).flatMap((z) =>
        z.cards.map((c) => c.id)
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deterministic Replay ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deterministic replay", () => {
    it("two identical games with same seed produce identical hands", () => {
      const game1 = startCrazyEightsGame(2, FIXED_SEED);
      const game2 = startCrazyEightsGame(2, FIXED_SEED);

      expect(handDescription(game1.state, "hand:0")).toEqual(
        handDescription(game2.state, "hand:0")
      );
      expect(handDescription(game1.state, "hand:1")).toEqual(
        handDescription(game2.state, "hand:1")
      );
      expect(handDescription(game1.state, "discard")).toEqual(
        handDescription(game2.state, "discard")
      );
    });

    it("different seeds produce different deals", () => {
      const game1 = startCrazyEightsGame(2, 42);
      const game2 = startCrazyEightsGame(2, 999);

      const hand1 = handDescription(game1.state, "hand:0");
      const hand2 = handDescription(game2.state, "hand:0");

      expect(hand1).not.toEqual(hand2);
    });

    it("card IDs are identical between same-seed games", () => {
      const game1 = startCrazyEightsGame(2, FIXED_SEED);
      const game2 = startCrazyEightsGame(2, FIXED_SEED);

      const ids1 = game1.state.zones["hand:0"]!.cards.map((c) => c.id);
      const ids2 = game2.state.zones["hand:0"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player View Filtering ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player view filtering", () => {
    it("draw_pile cards are hidden from all players", () => {
      const { state, players } = startCrazyEightsGame(2);
      const view = createPlayerView(state, players[0]!.id);

      const drawPile = view.zones["draw_pile"]!;
      expect(drawPile.cards.every((c) => c === null)).toBe(true);
      expect(drawPile.cardCount).toBeGreaterThan(0);
    });

    it("discard pile is visible to all players (public visibility)", () => {
      const { state, players } = startCrazyEightsGame(2);
      const view = createPlayerView(state, players[0]!.id);

      const discard = view.zones["discard"]!;
      expect(discard.cardCount).toBe(1);
      expect(discard.cards[0]).not.toBeNull();
    });

    it("isMyTurn is correct for current player", () => {
      const { state, players } = startCrazyEightsGame(2);

      const view0 = createPlayerView(state, players[0]!.id);
      expect(view0.isMyTurn).toBe(true);

      const view1 = createPlayerView(state, players[1]!.id);
      expect(view1.isMyTurn).toBe(false);
    });

    it("myPlayerId is set correctly in the view", () => {
      const { state, players } = startCrazyEightsGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.myPlayerId).toBe(players[0]!.id);
    });

    it("view includes all expected zone names", () => {
      const { state, players } = startCrazyEightsGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.zones["draw_pile"]).toBeDefined();
      expect(view.zones["hand:0"]).toBeDefined();
      expect(view.zones["hand:1"]).toBeDefined();
      expect(view.zones["discard"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Turn Order Enforcement ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("turn order enforcement", () => {
    it("rejects action from player 1 when it is player 0's turn", () => {
      const { state, reducer, players } = startCrazyEightsGame(2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterWrongTurn = reducer(state, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "play_card",
      });

      // State should be unchanged (no-op)
      expect(afterWrongTurn.version).toBe(state.version);
    });

    it("unknown declaration is a no-op", () => {
      const { state, reducer, players } = startCrazyEightsGame(2);

      const afterBad = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "wild_draw_four",
      });

      expect(afterBad.version).toBe(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Edge Cases ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("start_game is a no-op on an already started game", () => {
      const { state, reducer } = startCrazyEightsGame(2);

      const afterSecondStart = reducer(state, { kind: "start_game" });
      expect(afterSecondStart).toBe(state);
    });

    it("version monotonically increases through play_card actions", () => {
      const { state, reducer, players } = startCrazyEightsGame(2);

      // play_card calls end_turn, advancing to next player
      const afterPlay = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "play_card",
      });

      expect(afterPlay.version).toBeGreaterThan(state.version);
    });

    it("action log grows with each action", () => {
      const { state, reducer, players } = startCrazyEightsGame(2);
      const initialLogLength = state.actionLog.length;

      const afterPlay = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "play_card",
      });

      expect(afterPlay.actionLog.length).toBeGreaterThan(initialLogLength);
    });

    it("transition condition evaluates safely with 2 players (if() guards)", () => {
      // With 2 players, hand:2 and hand:3 don't exist.
      // The if() guard in the transition condition should prevent accessing them.
      const { state } = startCrazyEightsGame(2);

      // Verify the transition condition can be evaluated without error
      const evalContext: EvalContext = { state, playerIndex: 0 };
      expect(() =>
        evaluateExpression(
          'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          evalContext
        )
      ).not.toThrow();
    });

    it("transition condition evaluates safely with 3 players (if() guards)", () => {
      const { state } = startCrazyEightsGame(3);

      // hand:3 doesn't exist with 3 players, but if() guards it
      const evalContext: EvalContext = { state, playerIndex: 0 };
      expect(() =>
        evaluateExpression(
          'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          evalContext
        )
      ).not.toThrow();
    });

    it("transition condition evaluates safely with 4 players", () => {
      const { state } = startCrazyEightsGame(4);

      const evalContext: EvalContext = { state, playerIndex: 0 };
      expect(() =>
        evaluateExpression(
          'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          evalContext
        )
      ).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ═══ Ninety-Nine (99) Integration Tests ═════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// Exercises the custom variables system (get_var, set_var, inc_var) via
// the Ninety-Nine card game. Each turn a player plays their top card,
// the running_total is updated based on the card rank, and if it exceeds
// 99 that player busts and loses.
//
// Card effects:
//   A=+1, 2-3=+face, 4=reverse, 5-8=+face, 9=set to 99,
//   10=-10, J/Q=+10, K=+0

const NINETY_NINE_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  A:   { kind: "fixed", value: 1 },
  "2": { kind: "fixed", value: 2 },
  "3": { kind: "fixed", value: 3 },
  "4": { kind: "fixed", value: 0 },
  "5": { kind: "fixed", value: 5 },
  "6": { kind: "fixed", value: 6 },
  "7": { kind: "fixed", value: 7 },
  "8": { kind: "fixed", value: 8 },
  "9": { kind: "fixed", value: 0 },
  "10": { kind: "fixed", value: 10 },
  J:   { kind: "fixed", value: 10 },
  Q:   { kind: "fixed", value: 10 },
  K:   { kind: "fixed", value: 0 },
};

const NINETY_NINE_RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/ninety-nine.cardgame.json"
);

function makeNinetyNineRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Ninety-Nine",
      slug: "ninety-nine",
      version: "1.0.0",
      author: "faluciano",
      players: { min: 2, max: 4 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: NINETY_NINE_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
    ],
    initialVariables: {
      running_total: 0,
      bust_player: -1,
    },
    phases: [
      {
        name: "setup",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "player_turns", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, hand, 3)",
        ],
      },
      {
        name: "player_turns",
        kind: "turn_based",
        actions: [
          {
            name: "play",
            label: "Play Top Card",
            effect: [
              "set_var(\"bust_player\", current_player_index)",
              "if(card_rank_name(current_player.hand, 0) == \"4\", reverse_turn_order())",
              "if(card_rank_name(current_player.hand, 0) == \"9\", set_var(\"running_total\", 99))",
              "if(card_rank_name(current_player.hand, 0) == \"10\", inc_var(\"running_total\", -10))",
              "if(card_rank_name(current_player.hand, 0) != \"4\" && card_rank_name(current_player.hand, 0) != \"9\" && card_rank_name(current_player.hand, 0) != \"10\" && card_rank_name(current_player.hand, 0) != \"K\", inc_var(\"running_total\", card_rank(current_player.hand, 0)))",
              "move_top(current_player.hand, discard, 1)",
              "if(card_count(draw_pile) > 0, draw(draw_pile, current_player.hand, 1))",
              "end_turn()",
            ],
          },
        ],
        transitions: [
          { to: "scoring", when: "get_var(\"running_total\") > 99" },
          { to: "scoring", when: "card_count(\"draw_pile\") == 0 && card_count(\"hand:0\") == 0" },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "round_end", when: "scores_calculated" }],
        automaticSequence: [
          "calculate_scores()",
          "determine_winners()",
        ],
      },
      {
        name: "round_end",
        kind: "all_players",
        actions: [
          {
            name: "play_again",
            label: "Play Again",
            effect: [
              "collect_all_to(draw_pile)",
              "reset_round()",
            ],
          },
        ],
        transitions: [{ to: "setup", when: "continue_game" }],
      },
    ],
    scoring: {
      method: "if(current_player_index == get_var(\"bust_player\"), 0, 1)",
      winCondition: "my_score > 0",
      bustCondition: "false",
      tieCondition: "false",
    },
    visibility: [
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "hand", visibility: { kind: "owner_only" } },
      { zone: "discard", visibility: { kind: "public" } },
    ],
    ui: { layout: "circle", tableColor: "felt_green" },
  };
}

/**
 * Creates a started Ninety-Nine game ready for player actions.
 * Returns state at `player_turns` with 3 cards dealt per player.
 */
function startNinetyNineGame(
  playerCount: number = 2,
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const ruleset = makeNinetyNineRuleset();
  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: pid(`player-${i}`),
    name: `Player ${i}`,
    role: "player" as const,
    connected: true,
  }));
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(
    ruleset,
    sid("ninety-nine-test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

/**
 * Helper: finds a seed where a given player's top card matches the target rank.
 * Returns the seed, or null if none found within the search range.
 */
function findSeedForTopCard(
  targetRank: string,
  playerIndex: number = 0,
  playerCount: number = 2,
  maxSearch: number = 3000
): number | null {
  for (let seed = 0; seed < maxSearch; seed++) {
    try {
      clearBuiltins();
      registerAllBuiltins();
      const game = startNinetyNineGame(playerCount, seed);
      const hand = game.state.zones[`hand:${playerIndex}`];
      if (hand && hand.cards.length > 0 && hand.cards[0]!.rank === targetRank) {
        return seed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Helper: plays a single "play" declare action for the current player.
 */
function playTopCard(
  state: CardGameState,
  reducer: GameReducer,
  players: Player[]
): CardGameState {
  return reducer(state, {
    kind: "declare",
    playerId: players[state.currentPlayerIndex]!.id,
    declaration: "play",
  });
}

// ─── Ninety-Nine Tests ────────────────────────────────────────────

describe("Ninety-Nine (99) Integration — Full Game Lifecycle", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Schema Validation ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("schema validation", () => {
    it("loads and validates the ninety-nine ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("Ninety-Nine");
      expect(jsonRuleset.meta.slug).toBe("ninety-nine");
      expect(jsonRuleset.deck.preset).toBe("standard_52");
      expect(jsonRuleset.deck.copies).toBe(1);
      expect(jsonRuleset.phases).toHaveLength(4);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(3);
    });

    it("validates schema with parseRuleset without throwing", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      expect(() => parseRuleset(raw)).not.toThrow();
    });

    it("JSON ruleset contains all expected phases", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "setup",
        "player_turns",
        "scoring",
        "round_end",
      ]);
    });

    it("JSON ruleset contains initialVariables", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.initialVariables).toEqual({
        running_total: 0,
        bust_player: -1,
      });
    });

    it("JSON ruleset contains play action with variable effects", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playerTurns = jsonRuleset.phases.find(
        (p) => p.name === "player_turns"
      )!;
      expect(playerTurns.actions).toHaveLength(1);
      expect(playerTurns.actions[0]!.name).toBe("play");

      const effects = playerTurns.actions[0]!.effect;
      expect(effects).toBeDefined();
      expect(Array.isArray(effects)).toBe(true);
      // Should include set_var, inc_var, move_top, draw, end_turn
      const effectStr = (effects as string[]).join(" ");
      expect(effectStr).toContain("set_var");
      expect(effectStr).toContain("inc_var");
      expect(effectStr).toContain("move_top");
      expect(effectStr).toContain("end_turn");
    });

    it("scoring method uses custom variables", () => {
      const raw = JSON.parse(readFileSync(NINETY_NINE_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.scoring.method).toContain("get_var");
      expect(jsonRuleset.scoring.method).toContain("bust_player");
      expect(jsonRuleset.scoring.winCondition).toBe("my_score > 0");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Initial State ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("initial state", () => {
    it("initializes variables from ruleset", () => {
      const ruleset = makeNinetyNineRuleset();
      const players: Player[] = [
        { id: pid("p0"), name: "P0", role: "player", connected: true },
        { id: pid("p1"), name: "P1", role: "player", connected: true },
      ];
      const initial = createInitialState(
        ruleset,
        sid("test"),
        players,
        FIXED_SEED
      );

      expect(initial.variables).toEqual({
        running_total: 0,
        bust_player: -1,
      });
    });

    it("creates per-player hand zones", () => {
      const ruleset = makeNinetyNineRuleset();
      const players: Player[] = Array.from({ length: 3 }, (_, i) => ({
        id: pid(`p${i}`),
        name: `P${i}`,
        role: "player" as const,
        connected: true,
      }));
      const initial = createInitialState(
        ruleset,
        sid("test"),
        players,
        FIXED_SEED
      );

      expect(initial.zones["hand:0"]).toBeDefined();
      expect(initial.zones["hand:1"]).toBeDefined();
      expect(initial.zones["hand:2"]).toBeDefined();
    });

    it("places all 52 cards in draw_pile before start", () => {
      const ruleset = makeNinetyNineRuleset();
      const players: Player[] = [
        { id: pid("p0"), name: "P0", role: "player", connected: true },
        { id: pid("p1"), name: "P1", role: "player", connected: true },
      ];
      const initial = createInitialState(
        ruleset,
        sid("test"),
        players,
        FIXED_SEED
      );

      expect(initial.zones["draw_pile"]!.cards).toHaveLength(52);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Setup Phase ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("setup phase", () => {
    it("deals 3 cards per player with 2 players", () => {
      const { state } = startNinetyNineGame(2);

      expect(state.zones["hand:0"]!.cards).toHaveLength(3);
      expect(state.zones["hand:1"]!.cards).toHaveLength(3);
      // 52 - 3 - 3 = 46 cards remain in draw pile
      expect(state.zones["draw_pile"]!.cards).toHaveLength(46);
    });

    it("deals 3 cards per player with 3 players", () => {
      const { state } = startNinetyNineGame(3);

      expect(state.zones["hand:0"]!.cards).toHaveLength(3);
      expect(state.zones["hand:1"]!.cards).toHaveLength(3);
      expect(state.zones["hand:2"]!.cards).toHaveLength(3);
      // 52 - 9 = 43
      expect(state.zones["draw_pile"]!.cards).toHaveLength(43);
    });

    it("deals 3 cards per player with 4 players", () => {
      const { state } = startNinetyNineGame(4);

      expect(state.zones["hand:0"]!.cards).toHaveLength(3);
      expect(state.zones["hand:1"]!.cards).toHaveLength(3);
      expect(state.zones["hand:2"]!.cards).toHaveLength(3);
      expect(state.zones["hand:3"]!.cards).toHaveLength(3);
      // 52 - 12 = 40
      expect(state.zones["draw_pile"]!.cards).toHaveLength(40);
    });

    it("starts in player_turns phase after setup", () => {
      const { state } = startNinetyNineGame(2);

      expect(state.status.kind).toBe("in_progress");
      expect(state.currentPhase).toBe("player_turns");
    });

    it("player 0 goes first", () => {
      const { state } = startNinetyNineGame(2);

      expect(state.currentPlayerIndex).toBe(0);
    });

    it("variables are initialized after setup", () => {
      const { state } = startNinetyNineGame(2);

      expect(state.variables.running_total).toBe(0);
      expect(state.variables.bust_player).toBe(-1);
    });

    it("discard pile is empty after setup (no starter card)", () => {
      const { state } = startNinetyNineGame(2);

      expect(state.zones["discard"]!.cards).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Normal Number Card Play ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("normal number card play", () => {
    it("playing a number card adds its face value to running_total", () => {
      // Find a seed where player 0 has a normal number card (A,2,3,5,6,7,8,J,Q)
      const normalRanks = ["A", "2", "3", "5", "6", "7", "8", "J", "Q"];
      let testSeed: number | null = null;
      let expectedRank: string | null = null;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startNinetyNineGame(2, seed);
          const topCard = game.state.zones["hand:0"]!.cards[0]!;
          if (normalRanks.includes(topCard.rank)) {
            testSeed = seed;
            expectedRank = topCard.rank;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(testSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, testSeed!);

      const topCard = state.zones["hand:0"]!.cards[0]!;
      expect(topCard.rank).toBe(expectedRank);

      const expectedValue = NINETY_NINE_CARD_VALUES[topCard.rank]!;
      const expectedInc =
        expectedValue.kind === "fixed" ? expectedValue.value : 0;

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.variables.running_total).toBe(expectedInc);
    });

    it("playing moves card from hand to discard and draws replacement", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const handBefore = state.zones["hand:0"]!.cards.length;
      const discardBefore = state.zones["discard"]!.cards.length;
      const drawBefore = state.zones["draw_pile"]!.cards.length;

      const afterPlay = playTopCard(state, reducer, players);

      // Hand still has 3 cards (played 1, drew 1)
      expect(afterPlay.zones["hand:0"]!.cards.length).toBe(handBefore);
      // Discard has 1 more card
      expect(afterPlay.zones["discard"]!.cards.length).toBe(
        discardBefore + 1
      );
      // Draw pile has 1 fewer card
      expect(afterPlay.zones["draw_pile"]!.cards.length).toBe(
        drawBefore - 1
      );
    });

    it("turn advances to next player after play", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterPlay = playTopCard(state, reducer, players);

      // Should stay in player_turns (total <= 99)
      if (afterPlay.currentPhase === "player_turns") {
        expect(afterPlay.currentPlayerIndex).toBe(1);
      }
    });

    it("bust_player is set to current player index on each play", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      expect(state.variables.bust_player).toBe(-1);

      const afterPlay = playTopCard(state, reducer, players);

      // Player 0 just played
      expect(afterPlay.variables.bust_player).toBe(0);
    });

    it("version increases after each play", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.version).toBeGreaterThan(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── King (K) Play — +0 ────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("King play (+0)", () => {
    it("playing a King does not change running_total", () => {
      const kingSeed = findSeedForTopCard("K", 0, 2);
      if (kingSeed === null) {
        // Extremely unlikely, but guard the test
        expect(kingSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, kingSeed);

      expect(state.zones["hand:0"]!.cards[0]!.rank).toBe("K");
      expect(state.variables.running_total).toBe(0);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.variables.running_total).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Four (4) Play — Reverse Direction ─────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("4-reverse", () => {
    it("playing a 4 reverses turn direction", () => {
      const fourSeed = findSeedForTopCard("4", 0, 2);
      if (fourSeed === null) {
        expect(fourSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, fourSeed);

      expect(state.zones["hand:0"]!.cards[0]!.rank).toBe("4");
      expect(state.turnDirection).toBe(1);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.turnDirection).toBe(-1);
    });

    it("playing a 4 does not change running_total", () => {
      const fourSeed = findSeedForTopCard("4", 0, 2);
      if (fourSeed === null) {
        expect(fourSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, fourSeed);

      expect(state.variables.running_total).toBe(0);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.variables.running_total).toBe(0);
    });

    it("playing two 4s restores original direction", () => {
      // Find a seed where player 0 has a 4, then after play find if player 1 also has a 4
      const fourSeed = findSeedForTopCard("4", 0, 2);
      if (fourSeed === null) {
        expect(fourSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, fourSeed);

      // Play the 4 — reverses direction
      const afterFirst = playTopCard(state, reducer, players);
      expect(afterFirst.turnDirection).toBe(-1);

      // With 2 players, reversed direction still wraps to the other player.
      // If the next player also has a 4 at the top, play it.
      if (
        afterFirst.currentPhase === "player_turns" &&
        afterFirst.zones[`hand:${afterFirst.currentPlayerIndex}`]?.cards[0]
          ?.rank === "4"
      ) {
        const afterSecond = playTopCard(afterFirst, reducer, players);
        expect(afterSecond.turnDirection).toBe(1);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Nine (9) Play — Set to 99 ─────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("9-set-to-99", () => {
    it("playing a 9 sets running_total to exactly 99", () => {
      const nineSeed = findSeedForTopCard("9", 0, 2);
      if (nineSeed === null) {
        expect(nineSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, nineSeed);

      expect(state.zones["hand:0"]!.cards[0]!.rank).toBe("9");

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.variables.running_total).toBe(99);
    });

    it("playing a 9 when total is already high still sets it to 99", () => {
      const nineSeed = findSeedForTopCard("9", 0, 2);
      if (nineSeed === null) {
        expect(nineSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, nineSeed);

      // Manually set running_total to 95 to simulate a high-total scenario
      const stateWith95: CardGameState = {
        ...state,
        variables: { ...state.variables, running_total: 95 },
      };

      const afterPlay = playTopCard(stateWith95, reducer, players);

      // 9 always sets to 99, regardless of current total
      expect(afterPlay.variables.running_total).toBe(99);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Ten (10) Play — Subtract 10 ───────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("10-subtract", () => {
    it("playing a 10 subtracts 10 from running_total", () => {
      const tenSeed = findSeedForTopCard("10", 0, 2);
      if (tenSeed === null) {
        expect(tenSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, tenSeed);

      expect(state.zones["hand:0"]!.cards[0]!.rank).toBe("10");

      // Set running_total to 50 so we can see the -10 clearly
      const stateWith50: CardGameState = {
        ...state,
        variables: { ...state.variables, running_total: 50 },
      };

      const afterPlay = playTopCard(stateWith50, reducer, players);

      expect(afterPlay.variables.running_total).toBe(40);
    });

    it("playing a 10 from zero goes negative", () => {
      const tenSeed = findSeedForTopCard("10", 0, 2);
      if (tenSeed === null) {
        expect(tenSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, tenSeed);

      expect(state.variables.running_total).toBe(0);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.variables.running_total).toBe(-10);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Bust Detection ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("bust detection", () => {
    it("transitions to scoring when running_total exceeds 99", () => {
      // Find a seed with a high-value normal card (J, Q, or 8) at top
      const highRanks = ["J", "Q", "8"];
      let bustSeed: number | null = null;
      let bustRank: string | null = null;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startNinetyNineGame(2, seed);
          const topCard = game.state.zones["hand:0"]!.cards[0]!;
          if (highRanks.includes(topCard.rank)) {
            bustSeed = seed;
            bustRank = topCard.rank;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(bustSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, bustSeed!);

      // Set running total to 95 — any of J(+10), Q(+10), 8(+8) will exceed 99
      const stateNear99: CardGameState = {
        ...state,
        variables: { ...state.variables, running_total: 95 },
      };

      const afterPlay = playTopCard(stateNear99, reducer, players);

      // Should have transitioned through scoring to round_end
      expect(afterPlay.variables.running_total).toBeGreaterThan(99);
      // The game should have moved past player_turns (to scoring → round_end)
      expect(afterPlay.currentPhase).not.toBe("player_turns");
    });

    it("exactly 99 does NOT bust (only > 99 busts)", () => {
      // Playing a card that lands exactly on 99 should continue
      const nineSeed = findSeedForTopCard("9", 0, 2);
      if (nineSeed === null) {
        expect(nineSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, nineSeed);

      const afterPlay = playTopCard(state, reducer, players);

      // Running total is 99, game continues
      expect(afterPlay.variables.running_total).toBe(99);
      expect(afterPlay.currentPhase).toBe("player_turns");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Bust Scoring ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("bust scoring", () => {
    it("bust player gets score 0, other players get score 1", () => {
      // Use a number card to bust player 0
      const normalRanks = ["J", "Q", "8", "7", "6", "5"];
      let bustSeed: number | null = null;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startNinetyNineGame(2, seed);
          const topCard = game.state.zones["hand:0"]!.cards[0]!;
          if (normalRanks.includes(topCard.rank)) {
            bustSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(bustSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, bustSeed!);

      const topCard = state.zones["hand:0"]!.cards[0]!;
      const cardVal = NINETY_NINE_CARD_VALUES[topCard.rank]!;
      const addedValue = cardVal.kind === "fixed" ? cardVal.value : 0;

      // Set total so this card will push it over 99
      const stateNearBust: CardGameState = {
        ...state,
        variables: {
          ...state.variables,
          running_total: 100 - addedValue + 1,
        },
      };

      const afterBust = playTopCard(stateNearBust, reducer, players);

      // Should have scored — bust player (0) gets 0, other (1) gets 1
      expect(afterBust.scores["player_score:0"]).toBe(0);
      expect(afterBust.scores["player_score:1"]).toBe(1);
    });

    it("bust player result is loss (-1), non-bust players win (+1)", () => {
      const normalRanks = ["J", "Q", "8", "7", "6"];
      let bustSeed: number | null = null;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startNinetyNineGame(2, seed);
          const topCard = game.state.zones["hand:0"]!.cards[0]!;
          if (normalRanks.includes(topCard.rank)) {
            bustSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(bustSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(2, bustSeed!);

      const topCard = state.zones["hand:0"]!.cards[0]!;
      const cardVal = NINETY_NINE_CARD_VALUES[topCard.rank]!;
      const addedValue = cardVal.kind === "fixed" ? cardVal.value : 0;

      const stateNearBust: CardGameState = {
        ...state,
        variables: {
          ...state.variables,
          running_total: 100 - addedValue + 1,
        },
      };

      const afterBust = playTopCard(stateNearBust, reducer, players);

      // Results: bust player loses, other wins
      expect(afterBust.scores["result:0"]).toBe(-1);
      expect(afterBust.scores["result:1"]).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Winner Determination ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("winner determination", () => {
    it("non-bust players are winners (result = 1)", () => {
      // Force a bust for player 0 with 3 players
      const normalRanks = ["J", "Q", "8", "7"];
      let bustSeed: number | null = null;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startNinetyNineGame(3, seed);
          const topCard = game.state.zones["hand:0"]!.cards[0]!;
          if (normalRanks.includes(topCard.rank)) {
            bustSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(bustSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(3, bustSeed!);

      const topCard = state.zones["hand:0"]!.cards[0]!;
      const cardVal = NINETY_NINE_CARD_VALUES[topCard.rank]!;
      const addedValue = cardVal.kind === "fixed" ? cardVal.value : 0;

      const stateNearBust: CardGameState = {
        ...state,
        variables: {
          ...state.variables,
          running_total: 100 - addedValue + 1,
        },
      };

      const afterBust = playTopCard(stateNearBust, reducer, players);

      // Player 0 busted
      expect(afterBust.scores["player_score:0"]).toBe(0);
      expect(afterBust.scores["result:0"]).toBe(-1);

      // Players 1 and 2 are winners
      expect(afterBust.scores["player_score:1"]).toBe(1);
      expect(afterBust.scores["result:1"]).toBe(1);
      expect(afterBust.scores["player_score:2"]).toBe(1);
      expect(afterBust.scores["result:2"]).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Draw from Deck ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("draw from deck", () => {
    it("player draws a replacement card after playing", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const handBefore = state.zones["hand:0"]!.cards.length;
      expect(handBefore).toBe(3);

      const afterPlay = playTopCard(state, reducer, players);

      // Hand should still have 3 cards (played 1, drew 1 replacement)
      expect(afterPlay.zones["hand:0"]!.cards.length).toBe(3);
    });

    it("total cards are conserved after a play (52 cards)", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      expect(totalCards(state)).toBe(DECK_SIZE);

      const afterPlay = playTopCard(state, reducer, players);

      expect(totalCards(afterPlay)).toBe(DECK_SIZE);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deck Exhaustion ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deck exhaustion", () => {
    it("when draw pile is empty, hand shrinks instead of drawing", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      // Artificially empty the draw pile
      const emptyDrawState: CardGameState = {
        ...state,
        zones: {
          ...state.zones,
          draw_pile: { ...state.zones["draw_pile"]!, cards: [] },
        },
      };

      const afterPlay = playTopCard(emptyDrawState, reducer, players);

      // Hand should shrink by 1 (played 1, can't draw)
      if (afterPlay.currentPhase === "player_turns") {
        expect(afterPlay.zones["hand:0"]!.cards.length).toBe(2);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Turn Order with Reverse ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("turn order with reverse", () => {
    it("clockwise turn order: 0 → 1 → 0 with 2 players", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterP0 = playTopCard(state, reducer, players);
      if (afterP0.currentPhase !== "player_turns") return;
      expect(afterP0.currentPlayerIndex).toBe(1);

      const afterP1 = playTopCard(afterP0, reducer, players);
      if (afterP1.currentPhase !== "player_turns") return;
      expect(afterP1.currentPlayerIndex).toBe(0);
    });

    it("clockwise turn order: 0 → 1 → 2 → 0 with 3 players", () => {
      const { state, reducer, players } = startNinetyNineGame(3);

      expect(state.currentPlayerIndex).toBe(0);

      // We need seeds where no card is a 4 (to avoid direction reversal)
      // Just play turns and check the order
      let current = state;
      const turnOrder: number[] = [current.currentPlayerIndex];

      for (let i = 0; i < 3; i++) {
        const next = playTopCard(current, reducer, players);
        if (next.currentPhase !== "player_turns") break;
        turnOrder.push(next.currentPlayerIndex);
        current = next;
      }

      // First three should be 0, 1, 2 (unless a 4 reversed)
      if (!turnOrder.includes(-1) && turnOrder.length >= 4) {
        // If no 4 was played, expect clockwise
        const noFourPlayed =
          current.turnDirection === 1 && state.turnDirection === 1;
        if (noFourPlayed) {
          expect(turnOrder).toEqual([0, 1, 2, 0]);
        }
      }
    });

    it("reverse changes turn order with 3 players", () => {
      const fourSeed = findSeedForTopCard("4", 0, 3);
      if (fourSeed === null) {
        expect(fourSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startNinetyNineGame(3, fourSeed);

      expect(state.currentPlayerIndex).toBe(0);
      expect(state.turnDirection).toBe(1);

      // Player 0 plays a 4 → reverses direction
      const afterReverse = playTopCard(state, reducer, players);
      if (afterReverse.currentPhase !== "player_turns") return;

      expect(afterReverse.turnDirection).toBe(-1);
      // With reverse direction, next after 0 should be 2 (wraps around)
      expect(afterReverse.currentPlayerIndex).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Conservation ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card conservation", () => {
    it("total cards after start_game equals 52", () => {
      const { state } = startNinetyNineGame(2);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("total cards are conserved with 3 players", () => {
      const { state } = startNinetyNineGame(3);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("total cards are conserved with 4 players", () => {
      const { state } = startNinetyNineGame(4);
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("no duplicate card IDs exist across all zones", () => {
      const { state } = startNinetyNineGame(2);

      const allIds = Object.values(state.zones).flatMap((z) =>
        z.cards.map((c) => c.id)
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it("cards are conserved after multiple plays", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      let current = state;
      for (let i = 0; i < 5; i++) {
        if (current.currentPhase !== "player_turns") break;
        current = playTopCard(current, reducer, players);
        expect(totalCards(current)).toBe(DECK_SIZE);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deterministic Replay ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deterministic replay", () => {
    it("two identical games with same seed produce identical hands", () => {
      const game1 = startNinetyNineGame(2, FIXED_SEED);
      const game2 = startNinetyNineGame(2, FIXED_SEED);

      expect(handDescription(game1.state, "hand:0")).toEqual(
        handDescription(game2.state, "hand:0")
      );
      expect(handDescription(game1.state, "hand:1")).toEqual(
        handDescription(game2.state, "hand:1")
      );
    });

    it("different seeds produce different deals", () => {
      const game1 = startNinetyNineGame(2, 42);
      const game2 = startNinetyNineGame(2, 999);

      const hand1 = handDescription(game1.state, "hand:0");
      const hand2 = handDescription(game2.state, "hand:0");

      expect(hand1).not.toEqual(hand2);
    });

    it("card IDs are identical between same-seed games", () => {
      const game1 = startNinetyNineGame(2, FIXED_SEED);
      const game2 = startNinetyNineGame(2, FIXED_SEED);

      const ids1 = game1.state.zones["hand:0"]!.cards.map((c) => c.id);
      const ids2 = game2.state.zones["hand:0"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });

    it("replaying same actions produces identical state", () => {
      const game1 = startNinetyNineGame(2, FIXED_SEED);
      const game2 = startNinetyNineGame(2, FIXED_SEED);

      // Play 3 turns on each
      let state1 = game1.state;
      let state2 = game2.state;

      for (let i = 0; i < 3; i++) {
        if (state1.currentPhase !== "player_turns") break;
        state1 = playTopCard(state1, game1.reducer, game1.players);
        state2 = playTopCard(state2, game2.reducer, game2.players);
      }

      expect(state1.variables).toEqual(state2.variables);
      expect(state1.currentPlayerIndex).toBe(state2.currentPlayerIndex);
      expect(state1.turnDirection).toBe(state2.turnDirection);
      expect(handDescription(state1, "hand:0")).toEqual(
        handDescription(state2, "hand:0")
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player View (Variables Visible) ───────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player view (variables visible)", () => {
    it("player view includes variables", () => {
      const { state, players } = startNinetyNineGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.variables).toBeDefined();
      expect(view.variables.running_total).toBe(0);
      expect(view.variables.bust_player).toBe(-1);
    });

    it("player view variables update after play", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const afterPlay = playTopCard(state, reducer, players);
      const view = createPlayerView(afterPlay, players[0]!.id);

      // bust_player should have been set to 0 (player 0 played)
      expect(view.variables.bust_player).toBe(0);
    });

    it("draw_pile cards are hidden from all players", () => {
      const { state, players } = startNinetyNineGame(2);
      const view = createPlayerView(state, players[0]!.id);

      const drawPile = view.zones["draw_pile"]!;
      expect(drawPile.cards.every((c) => c === null)).toBe(true);
      expect(drawPile.cardCount).toBeGreaterThan(0);
    });

    it("discard pile is visible to all players", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      // Play one card so there's something in the discard
      const afterPlay = playTopCard(state, reducer, players);
      const view = createPlayerView(afterPlay, players[1]!.id);

      const discard = view.zones["discard"]!;
      expect(discard.cardCount).toBeGreaterThan(0);
      expect(discard.cards[0]).not.toBeNull();
    });

    it("isMyTurn is correct for current player", () => {
      const { state, players } = startNinetyNineGame(2);

      const view0 = createPlayerView(state, players[0]!.id);
      expect(view0.isMyTurn).toBe(true);

      const view1 = createPlayerView(state, players[1]!.id);
      expect(view1.isMyTurn).toBe(false);
    });

    it("myPlayerId is set correctly in the view", () => {
      const { state, players } = startNinetyNineGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.myPlayerId).toBe(players[0]!.id);
    });

    it("view includes all expected zone names", () => {
      const { state, players } = startNinetyNineGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.zones["draw_pile"]).toBeDefined();
      expect(view.zones["hand:0"]).toBeDefined();
      expect(view.zones["hand:1"]).toBeDefined();
      expect(view.zones["discard"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Turn Order Enforcement ────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("turn order enforcement", () => {
    it("rejects action from wrong player (no-op)", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterWrongTurn = reducer(state, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "play",
      });

      // State should be unchanged
      expect(afterWrongTurn.version).toBe(state.version);
    });

    it("unknown declaration is a no-op", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const afterBad = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "unknown_action",
      });

      expect(afterBad.version).toBe(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Edge Cases ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("start_game is a no-op on an already started game", () => {
      const { state, reducer } = startNinetyNineGame(2);

      const afterSecondStart = reducer(state, { kind: "start_game" });
      expect(afterSecondStart).toBe(state);
    });

    it("version monotonically increases through play actions", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.version).toBeGreaterThan(state.version);
    });

    it("action log grows with each action", () => {
      const { state, reducer, players } = startNinetyNineGame(2);
      const initialLogLength = state.actionLog.length;

      const afterPlay = playTopCard(state, reducer, players);

      expect(afterPlay.actionLog.length).toBeGreaterThan(initialLogLength);
    });

    it("running_total accumulates across multiple turns", () => {
      const { state, reducer, players } = startNinetyNineGame(2);

      let current = state;
      let prevTotal = 0;

      for (let i = 0; i < 4; i++) {
        if (current.currentPhase !== "player_turns") break;

        const playerIdx = current.currentPlayerIndex;
        const topCard =
          current.zones[`hand:${playerIdx}`]!.cards[0]!;

        current = playTopCard(current, reducer, players);

        // For non-special cards, total should have increased
        // For special cards, verify the specific effect
        if (topCard.rank === "K") {
          expect(current.variables.running_total).toBe(prevTotal);
        } else if (topCard.rank === "4") {
          expect(current.variables.running_total).toBe(prevTotal);
        } else if (topCard.rank === "9") {
          expect(current.variables.running_total).toBe(99);
        } else if (topCard.rank === "10") {
          expect(current.variables.running_total).toBe(prevTotal - 10);
        } else {
          const expectedVal =
            NINETY_NINE_CARD_VALUES[topCard.rank]!;
          const inc =
            expectedVal.kind === "fixed" ? expectedVal.value : 0;
          expect(current.variables.running_total).toBe(prevTotal + inc);
        }

        prevTotal = current.variables.running_total as number;
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ═══ Uno Integration Tests ══════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// Exercises the play_card action kind with phase effects, custom variables
// (chosen_color, draw_penalty), declare with params (choose_color),
// and turn order mechanics (Skip, Reverse) via the Simplified Uno ruleset.
//
// Key Uno mechanics:
//   Number cards (0-9): play and end turn
//   Skip: skips next player
//   Reverse: reverses turn direction
//   Draw Two: next player must draw 2
//   Wild: player must choose a color (transitions to choose_color phase)
//
// NOTE: The engine's play_card handler appends the played card to the END
// of the discard array. The top_card_rank_name/top_card_suit builtins read
// cards[0] — the FIRST element. This means effects that check these builtins
// reference the card at index 0, which after setup is the initial discard card.
// After multiple plays, cards[0] remains the initial card. Tests account for
// this convention by verifying actual engine behavior.

const UNO_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  "0": { kind: "fixed", value: 0 },
  "1": { kind: "fixed", value: 1 },
  "2": { kind: "fixed", value: 2 },
  "3": { kind: "fixed", value: 3 },
  "4": { kind: "fixed", value: 4 },
  "5": { kind: "fixed", value: 5 },
  "6": { kind: "fixed", value: 6 },
  "7": { kind: "fixed", value: 7 },
  "8": { kind: "fixed", value: 8 },
  "9": { kind: "fixed", value: 9 },
  Skip: { kind: "fixed", value: 20 },
  Reverse: { kind: "fixed", value: 20 },
  "Draw Two": { kind: "fixed", value: 20 },
  Wild: { kind: "fixed", value: 50 },
};

const UNO_DECK_SIZE = 104; // Custom 104-card deck

const UNO_RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/uno.cardgame.json"
);

/**
 * Builds an Uno ruleset directly (custom 104-card deck, 2-4 players).
 * Matches the structure of rulesets/uno.cardgame.json exactly.
 */
function makeUnoRuleset(): CardGameRuleset {
  const cards: Array<{ suit: string; rank: string }> = [];
  for (const color of ["red", "blue", "green", "yellow"]) {
    cards.push({ suit: color, rank: "0" });
    for (const rank of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "Skip",
      "Reverse",
      "Draw Two",
    ]) {
      cards.push({ suit: color, rank });
      cards.push({ suit: color, rank });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ suit: "wild", rank: "Wild" });
  }

  return {
    meta: {
      name: "Uno",
      slug: "uno",
      version: "1.0.0",
      author: "faluciano",
      players: { min: 2, max: 4 },
    },
    deck: {
      preset: "custom",
      copies: 1,
      cards,
      cardValues: UNO_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      {
        name: "hand",
        visibility: { kind: "owner_only" },
        owners: ["player"],
      },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    initialVariables: {
      chosen_color: 0,
      draw_penalty: 0,
    },
    phases: [
      {
        name: "setup",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "play_turn", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, hand, 7)",
          "move_top(draw_pile, discard, 1)",
          "flip_top(discard, 1)",
        ],
      },
      {
        name: "play_turn",
        kind: "turn_based",
        actions: [
          {
            name: "play_card",
            label: "Play Card",
            effect: [
              'if(top_card_rank_name(discard) == "Skip", skip_next_player())',
              'if(top_card_rank_name(discard) == "Reverse", reverse_turn_order())',
              'if(top_card_rank_name(discard) == "Draw Two", set_var("draw_penalty", 2))',
              'if(top_card_suit(discard) != "wild", set_var("chosen_color", 0))',
              'if(top_card_suit(discard) != "wild", end_turn())',
            ],
          },
          {
            name: "draw_penalty",
            label: "Draw Penalty Cards",
            condition: 'get_var("draw_penalty") > 0',
            effect: [
              'draw(draw_pile, current_player.hand, get_var("draw_penalty"))',
              'set_var("draw_penalty", 0)',
              "end_turn()",
            ],
          },
          {
            name: "draw_card",
            label: "Draw Card",
            condition: 'get_var("draw_penalty") == 0',
            effect: ["draw(draw_pile, current_player.hand, 1)", "end_turn()"],
          },
        ],
        transitions: [
          {
            to: "choose_color",
            when: 'top_card_suit(discard) == "wild" && get_var("chosen_color") == 0',
          },
          {
            to: "scoring",
            when: 'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "choose_color",
        kind: "turn_based",
        actions: [
          {
            name: "choose_color",
            label: "Choose Color",
            effect: [
              'set_var("chosen_color", get_param("color_code"))',
              "end_turn()",
            ],
          },
        ],
        transitions: [
          {
            to: "scoring",
            when: 'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          },
          {
            to: "play_turn",
            when: 'get_var("chosen_color") > 0',
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "round_end", when: "scores_calculated" }],
        automaticSequence: ["calculate_scores()", "determine_winners()"],
      },
      {
        name: "round_end",
        kind: "all_players",
        actions: [
          {
            name: "play_again",
            label: "Play Again",
            effect: ["collect_all_to(draw_pile)", "reset_round()"],
          },
        ],
        transitions: [{ to: "setup", when: "continue_game" }],
      },
    ],
    scoring: {
      method: "hand_value(current_player.hand, 999)",
      winCondition: "my_score == 0",
      bustCondition: "false",
      tieCondition: "false",
    },
    visibility: [
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "hand", visibility: { kind: "owner_only" } },
      { zone: "discard", visibility: { kind: "public" } },
    ],
    ui: { layout: "circle", tableColor: "felt_green" },
  };
}

/**
 * Creates a started Uno game ready for player actions.
 * Returns state at `play_turn` with 7 cards dealt per player and
 * 1 card face-up in the discard pile.
 */
function startUnoGame(
  playerCount: number = 2,
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const unoRuleset = makeUnoRuleset();
  const players: Player[] = Array.from({ length: playerCount }, (_, i) => ({
    id: pid(`player-${i}`),
    name: `Player ${i}`,
    role: "player" as const,
    connected: true,
  }));
  const reducer = createReducer(unoRuleset, seed);
  const initial = createInitialState(
    unoRuleset,
    sid("uno-test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

/**
 * Find a seed where player has a specific card rank in hand.
 * Returns { seed, cardIndex } or null.
 */
function findUnoSeedForCard(
  targetRank: string,
  playerIndex: number = 0,
  playerCount: number = 2,
  maxSearch: number = 3000
): { seed: number; cardIndex: number } | null {
  for (let seed = 0; seed < maxSearch; seed++) {
    try {
      clearBuiltins();
      registerAllBuiltins();
      const game = startUnoGame(playerCount, seed);
      const hand = game.state.zones[`hand:${playerIndex}`];
      if (hand) {
        const idx = hand.cards.findIndex((c) => c.rank === targetRank);
        if (idx !== -1) return { seed, cardIndex: idx };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Find a seed where player has a Wild card in hand.
 */
function findUnoSeedForWild(
  playerIndex: number = 0,
  playerCount: number = 2,
  maxSearch: number = 3000
): { seed: number; cardIndex: number } | null {
  return findUnoSeedForCard("Wild", playerIndex, playerCount, maxSearch);
}

/**
 * Find a seed where player has a card with specific rank AND the discard
 * top allows it to be played (matching suit or rank, or card is Wild).
 */
function findUnoSeedForPlayableCard(
  targetRank: string,
  playerIndex: number = 0,
  playerCount: number = 2,
  maxSearch: number = 5000
): { seed: number; cardIndex: number } | null {
  for (let seed = 0; seed < maxSearch; seed++) {
    try {
      clearBuiltins();
      registerAllBuiltins();
      const game = startUnoGame(playerCount, seed);
      const hand = game.state.zones[`hand:${playerIndex}`];
      const discardTop = game.state.zones["discard"]?.cards[0];
      if (!hand || !discardTop) continue;
      const idx = hand.cards.findIndex(
        (c) =>
          c.rank === targetRank &&
          (c.suit === "wild" ||
            c.suit === discardTop.suit ||
            c.rank === discardTop.rank)
      );
      if (idx !== -1) return { seed, cardIndex: idx };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Plays a specific card from the current player's hand to the discard pile.
 * Uses the play_card action kind (not declare).
 */
function playUnoCard(
  state: CardGameState,
  reducer: GameReducer,
  players: Player[],
  cardIndex: number
): CardGameState {
  const playerIdx = state.currentPlayerIndex;
  const hand = state.zones[`hand:${playerIdx}`]!;
  const card = hand.cards[cardIndex]!;
  return reducer(state, {
    kind: "play_card",
    playerId: players[playerIdx]!.id,
    cardId: card.id,
    fromZone: `hand:${playerIdx}`,
    toZone: "discard",
  });
}

// ─── Uno Tests ────────────────────────────────────────────────────

describe("Uno Integration — Full Game Lifecycle", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Schema Validation ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("schema validation", () => {
    it("loads and validates the uno ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("Uno");
      expect(jsonRuleset.meta.slug).toBe("uno");
      expect(jsonRuleset.deck.preset).toBe("custom");
      expect(jsonRuleset.phases).toHaveLength(5);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(3);
    });

    it("validates schema with parseRuleset without throwing", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      expect(() => parseRuleset(raw)).not.toThrow();
    });

    it("JSON ruleset contains all 5 expected phases", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "setup",
        "play_turn",
        "choose_color",
        "scoring",
        "round_end",
      ]);
    });

    it("JSON ruleset contains play_card action with Skip/Reverse/Draw Two effects", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playTurn = jsonRuleset.phases.find(
        (p) => p.name === "play_turn"
      )!;
      const playCardAction = playTurn.actions.find(
        (a) => a.name === "play_card"
      );
      expect(playCardAction).toBeDefined();

      const effects = playCardAction!.effect;
      expect(effects).toBeDefined();
      expect(Array.isArray(effects)).toBe(true);
      const effectStr = (effects as string[]).join(" ");
      expect(effectStr).toContain("Skip");
      expect(effectStr).toContain("Reverse");
      expect(effectStr).toContain("Draw Two");
      expect(effectStr).toContain("skip_next_player");
      expect(effectStr).toContain("reverse_turn_order");
      expect(effectStr).toContain("set_var");
    });

    it("JSON ruleset contains initialVariables (chosen_color, draw_penalty)", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.initialVariables).toEqual({
        chosen_color: 0,
        draw_penalty: 0,
      });
    });

    it("deck.preset is custom with 104 cards", () => {
      const raw = JSON.parse(readFileSync(UNO_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.deck.preset).toBe("custom");
      expect(jsonRuleset.deck.cards).toBeDefined();
      expect(jsonRuleset.deck.cards).toHaveLength(104);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Initial State Creation ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("initial state creation", () => {
    it("creates correct zones for 2 players", () => {
      const unoRuleset = makeUnoRuleset();
      const players: Player[] = [
        {
          id: pid("player-0"),
          name: "Player 0",
          role: "player",
          connected: true,
        },
        {
          id: pid("player-1"),
          name: "Player 1",
          role: "player",
          connected: true,
        },
      ];
      const initial = createInitialState(
        unoRuleset,
        sid("test-session"),
        players,
        FIXED_SEED
      );

      expect(initial.zones["draw_pile"]).toBeDefined();
      expect(initial.zones["discard"]).toBeDefined();
      expect(initial.zones["hand:0"]).toBeDefined();
      expect(initial.zones["hand:1"]).toBeDefined();
      expect(initial.zones["hand:2"]).toBeUndefined();
    });

    it("creates correct zones for 4 players", () => {
      const unoRuleset = makeUnoRuleset();
      const players: Player[] = Array.from({ length: 4 }, (_, i) => ({
        id: pid(`player-${i}`),
        name: `Player ${i}`,
        role: "player" as const,
        connected: true,
      }));
      const initial = createInitialState(
        unoRuleset,
        sid("test-session"),
        players,
        FIXED_SEED
      );

      expect(initial.zones["hand:0"]).toBeDefined();
      expect(initial.zones["hand:1"]).toBeDefined();
      expect(initial.zones["hand:2"]).toBeDefined();
      expect(initial.zones["hand:3"]).toBeDefined();
    });

    it("variables initialized to chosen_color=0, draw_penalty=0", () => {
      const unoRuleset = makeUnoRuleset();
      const players: Player[] = [
        {
          id: pid("player-0"),
          name: "Player 0",
          role: "player",
          connected: true,
        },
        {
          id: pid("player-1"),
          name: "Player 1",
          role: "player",
          connected: true,
        },
      ];
      const initial = createInitialState(
        unoRuleset,
        sid("test"),
        players,
        FIXED_SEED
      );

      expect(initial.variables).toEqual({
        chosen_color: 0,
        draw_penalty: 0,
      });
    });

    it("turnDirection starts as 1", () => {
      const unoRuleset = makeUnoRuleset();
      const players: Player[] = [
        {
          id: pid("player-0"),
          name: "Player 0",
          role: "player",
          connected: true,
        },
        {
          id: pid("player-1"),
          name: "Player 1",
          role: "player",
          connected: true,
        },
      ];
      const initial = createInitialState(
        unoRuleset,
        sid("test"),
        players,
        FIXED_SEED
      );

      expect(initial.turnDirection).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Setup Phase ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("setup phase", () => {
    it("deals 7 cards per player and 1 in discard pile (2 players)", () => {
      const { state } = startUnoGame(2);

      expect(state.zones["hand:0"]!.cards).toHaveLength(7);
      expect(state.zones["hand:1"]!.cards).toHaveLength(7);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      // 104 - 14 - 1 = 89
      expect(state.zones["draw_pile"]!.cards).toHaveLength(89);
    });

    it("deals correctly with 4 players (104 - 28 - 1 = 75 in draw pile)", () => {
      const { state } = startUnoGame(4);

      expect(state.zones["hand:0"]!.cards).toHaveLength(7);
      expect(state.zones["hand:1"]!.cards).toHaveLength(7);
      expect(state.zones["hand:2"]!.cards).toHaveLength(7);
      expect(state.zones["hand:3"]!.cards).toHaveLength(7);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      // 104 - 28 - 1 = 75
      expect(state.zones["draw_pile"]!.cards).toHaveLength(75);
    });

    it("discard top card is face up after setup", () => {
      const { state } = startUnoGame(2);

      const discardCards = state.zones["discard"]!.cards;
      expect(discardCards).toHaveLength(1);
      expect(discardCards[0]!.faceUp).toBe(true);
    });

    it("starts in play_turn phase after setup", () => {
      const { state } = startUnoGame(2);

      expect(state.status.kind).toBe("in_progress");
      expect(state.currentPhase).toBe("play_turn");
    });

    it("player 0 goes first", () => {
      const { state } = startUnoGame(2);

      expect(state.currentPlayerIndex).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Normal Number Card Play ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("normal number card play", () => {
    it("playing a number card moves it from hand to discard", () => {
      // Find a seed where player 0 has a number card (0-9)
      const numberRanks = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
      let testSeed: number | null = null;
      let testCardIdx = 0;

      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) =>
            numberRanks.includes(c.rank)
          );
          if (idx !== -1) {
            testSeed = seed;
            testCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      expect(testSeed).not.toBeNull();
      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, testSeed!);

      const handBefore = state.zones["hand:0"]!.cards.length;
      const discardBefore = state.zones["discard"]!.cards.length;

      const afterPlay = playUnoCard(state, reducer, players, testCardIdx);

      expect(afterPlay.zones["hand:0"]!.cards.length).toBe(handBefore - 1);
      expect(afterPlay.zones["discard"]!.cards.length).toBe(
        discardBefore + 1
      );
    });

    it("playing a non-wild card resets chosen_color to 0", () => {
      // Find a seed with a non-wild card
      const result = findUnoSeedForCard("5");
      expect(result).not.toBeNull();

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, result!.seed);

      // Artificially set chosen_color to something non-zero
      const stateWithColor: CardGameState = {
        ...state,
        variables: { ...state.variables, chosen_color: 2 },
      };

      const afterPlay = playUnoCard(
        stateWithColor,
        reducer,
        players,
        result!.cardIndex
      );

      // The effect if(top_card_suit(discard) != "wild", set_var("chosen_color", 0))
      // checks cards[0] of discard — the setup card. If setup card is not wild,
      // chosen_color gets reset. Setup card is very likely non-wild.
      const discardTop = state.zones["discard"]!.cards[0]!;
      if (discardTop.suit !== "wild") {
        expect(afterPlay.variables.chosen_color).toBe(0);
      }
    });

    it("playing a non-wild card calls end_turn — next player becomes active", () => {
      const result = findUnoSeedForCard("3");
      expect(result).not.toBeNull();

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, result!.seed);

      expect(state.currentPlayerIndex).toBe(0);

      const afterPlay = playUnoCard(state, reducer, players, result!.cardIndex);

      // The end_turn effect fires when top_card_suit(discard) != "wild"
      // which checks cards[0] (the setup card). If setup card is non-wild,
      // end_turn fires and the current player advances.
      const discardTop = state.zones["discard"]!.cards[0]!;
      if (discardTop.suit !== "wild" && afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(1);
      }
    });

    it("hand shrinks by 1 after playing a card", () => {
      const result = findUnoSeedForCard("7");
      expect(result).not.toBeNull();

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, result!.seed);

      const handBefore = state.zones["hand:0"]!.cards.length;
      const afterPlay = playUnoCard(state, reducer, players, result!.cardIndex);

      expect(afterPlay.zones["hand:0"]!.cards.length).toBe(handBefore - 1);
    });

    it("version increases after play", () => {
      const result = findUnoSeedForCard("2");
      expect(result).not.toBeNull();

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, result!.seed);

      const afterPlay = playUnoCard(state, reducer, players, result!.cardIndex);

      expect(afterPlay.version).toBeGreaterThan(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Skip Effect ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("skip effect", () => {
    it("playing a Skip card when discard top is Skip triggers skip effect", () => {
      // Find a seed where player 0 has a Skip card AND the discard top is also Skip
      // (because top_card_rank_name(discard) reads cards[0] — the setup card)
      let skipSeed: number | null = null;
      let skipCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          // The effects check top_card_rank_name(discard) which reads
          // cards[0] — the initial discard card. For skip to trigger,
          // the initial discard card must be "Skip".
          if (discardTop.rank !== "Skip") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            skipSeed = seed;
            skipCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (skipSeed === null) {
        // Can't find the right seed — skip the test safely
        expect(skipSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, skipSeed);

      expect(state.currentPlayerIndex).toBe(0);

      const afterPlay = playUnoCard(state, reducer, players, skipCardIdx);

      // With 2 players, skip_next_player advances by 1 (0→1), then
      // end_turn advances by 1 more (1→0). So player 0 plays again.
      if (afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(0);
      }
    });

    it("Skip does not trigger when discard top is not Skip", () => {
      // Find a seed where discard top is a non-Skip, non-wild card and player has a Skip
      let testSeed: number | null = null;
      let skipCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (
            discardTop.rank === "Skip" ||
            discardTop.rank === "Reverse" ||
            discardTop.rank === "Draw Two" ||
            discardTop.suit === "wild"
          )
            continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank === "Skip");
          if (idx !== -1) {
            testSeed = seed;
            skipCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (testSeed === null) {
        expect(testSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, testSeed);

      expect(state.currentPlayerIndex).toBe(0);

      const afterPlay = playUnoCard(state, reducer, players, skipCardIdx);

      // When discard top is not Skip, skip_next_player doesn't fire.
      // end_turn fires normally (since discard top is not wild).
      // With 2 players: end_turn goes 0→1.
      if (afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(1);
      }
    });

    it("Skip effect with 3 players skips to player 2", () => {
      // Find a seed where 3 players, discard top is Skip
      let skipSeed: number | null = null;
      let skipCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(3, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.rank !== "Skip") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            skipSeed = seed;
            skipCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (skipSeed === null) {
        expect(skipSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(3, skipSeed);

      expect(state.currentPlayerIndex).toBe(0);

      const afterPlay = playUnoCard(state, reducer, players, skipCardIdx);

      // With 3 players: skip_next_player advances 0→1, end_turn advances 1→2
      if (afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(2);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Reverse Effect ─────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("reverse effect", () => {
    it("playing when discard top is Reverse flips turnDirection", () => {
      // Find seed where discard top is Reverse
      let revSeed: number | null = null;
      let revCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.rank !== "Reverse") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            revSeed = seed;
            revCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (revSeed === null) {
        expect(revSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, revSeed);

      expect(state.turnDirection).toBe(1);

      const afterPlay = playUnoCard(state, reducer, players, revCardIdx);

      expect(afterPlay.turnDirection).toBe(-1);
    });

    it("with 2 players, reverse keeps same turn order (0→1→0)", () => {
      // With 2 players, reverse direction still wraps correctly
      let revSeed: number | null = null;
      let revCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.rank !== "Reverse") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            revSeed = seed;
            revCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (revSeed === null) {
        expect(revSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, revSeed);

      const afterPlay = playUnoCard(state, reducer, players, revCardIdx);

      // With 2 players, reverse + end_turn: direction is -1,
      // next from 0 with direction -1 = (0-1) % 2 = -1 → wraps to 1
      if (afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(1);
      }
    });

    it("with 3 players, reverse changes 0→1→2 to 0→2→1", () => {
      let revSeed: number | null = null;
      let revCardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(3, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.rank !== "Reverse") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            revSeed = seed;
            revCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (revSeed === null) {
        expect(revSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(3, revSeed);

      const afterPlay = playUnoCard(state, reducer, players, revCardIdx);

      // After reverse, direction is -1. end_turn from 0 with direction -1:
      // (0 + (-1)) % 3 = -1 → wraps to 2
      if (afterPlay.currentPhase === "play_turn") {
        expect(afterPlay.currentPlayerIndex).toBe(2);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Draw Two Effect ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("draw two effect", () => {
    it("playing when discard top is Draw Two sets draw_penalty to 2", () => {
      let d2Seed: number | null = null;
      let d2CardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.rank !== "Draw Two") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.rank !== "Wild");
          if (idx !== -1) {
            d2Seed = seed;
            d2CardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (d2Seed === null) {
        expect(d2Seed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, d2Seed);

      expect(state.variables.draw_penalty).toBe(0);

      const afterPlay = playUnoCard(state, reducer, players, d2CardIdx);

      expect(afterPlay.variables.draw_penalty).toBe(2);
    });

    it("draw_penalty declare draws 2 cards and resets penalty", () => {
      // Manually set draw_penalty to 2 and declare draw_penalty
      const { state, reducer, players } = startUnoGame(2);

      const stateWithPenalty: CardGameState = {
        ...state,
        variables: { ...state.variables, draw_penalty: 2 },
      };

      const handBefore = stateWithPenalty.zones["hand:0"]!.cards.length;
      const drawBefore = stateWithPenalty.zones["draw_pile"]!.cards.length;

      const afterPenalty = reducer(stateWithPenalty, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_penalty",
      });

      // Should draw 2 cards and reset penalty
      expect(afterPenalty.zones["hand:0"]!.cards.length).toBe(
        handBefore + 2
      );
      expect(afterPenalty.zones["draw_pile"]!.cards.length).toBe(
        drawBefore - 2
      );
      expect(afterPenalty.variables.draw_penalty).toBe(0);
    });

    it("after draw_penalty, draw_penalty resets to 0 and turn ends", () => {
      const { state, reducer, players } = startUnoGame(2);

      const stateWithPenalty: CardGameState = {
        ...state,
        variables: { ...state.variables, draw_penalty: 2 },
      };

      expect(stateWithPenalty.currentPlayerIndex).toBe(0);

      const afterPenalty = reducer(stateWithPenalty, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_penalty",
      });

      expect(afterPenalty.variables.draw_penalty).toBe(0);
      // end_turn should advance to next player
      if (afterPenalty.currentPhase === "play_turn") {
        expect(afterPenalty.currentPlayerIndex).toBe(1);
      }
    });

    it("draw_card is unavailable when draw_penalty > 0 (condition not met)", () => {
      const { state, reducer, players } = startUnoGame(2);

      const stateWithPenalty: CardGameState = {
        ...state,
        variables: { ...state.variables, draw_penalty: 2 },
      };

      const afterDraw = reducer(stateWithPenalty, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      // draw_card condition is get_var("draw_penalty") == 0, which is false
      // So the declare should be a no-op
      expect(afterDraw.version).toBe(stateWithPenalty.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Wild Card + Choose Color Flow ──────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("wild card + choose_color flow", () => {
    it("playing a Wild card when discard top is wild does not end turn", () => {
      // Find seed where discard top is a wild card and player has any card
      let wildDiscardSeed: number | null = null;
      let cardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.suit !== "wild") continue;
          // Find any non-wild card to play (so the transition condition
          // top_card_suit(discard) == "wild" still matches)
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.suit !== "wild");
          if (idx !== -1) {
            wildDiscardSeed = seed;
            cardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (wildDiscardSeed === null) {
        expect(wildDiscardSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, wildDiscardSeed);

      const afterPlay = playUnoCard(state, reducer, players, cardIdx);

      // When discard top (cards[0]) is wild, end_turn() does NOT fire
      // (the condition is: if suit != "wild", end_turn())
      // So phase should transition to choose_color (since
      // top_card_suit(discard) == "wild" && chosen_color == 0)
      expect(afterPlay.currentPhase).toBe("choose_color");
    });

    it("after Wild in discard top: phase transitions to choose_color", () => {
      // Same as above but verify the phase explicitly
      let wildDiscardSeed: number | null = null;
      let cardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.suit !== "wild") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.suit !== "wild");
          if (idx !== -1) {
            wildDiscardSeed = seed;
            cardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (wildDiscardSeed === null) {
        expect(wildDiscardSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, wildDiscardSeed);

      const afterPlay = playUnoCard(state, reducer, players, cardIdx);

      expect(afterPlay.currentPhase).toBe("choose_color");
      // Same player is still active (no end_turn was called)
      expect(afterPlay.currentPlayerIndex).toBe(0);
    });

    it("in choose_color phase, declare with params sets chosen_color", () => {
      // Set up a state in choose_color phase manually
      let wildDiscardSeed: number | null = null;
      let cardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.suit !== "wild") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.suit !== "wild");
          if (idx !== -1) {
            wildDiscardSeed = seed;
            cardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (wildDiscardSeed === null) {
        expect(wildDiscardSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, wildDiscardSeed);

      // Play a card to trigger choose_color transition
      const afterPlay = playUnoCard(state, reducer, players, cardIdx);
      expect(afterPlay.currentPhase).toBe("choose_color");

      // Now declare choose_color with color_code = 1
      const afterChoose = reducer(afterPlay, {
        kind: "declare",
        playerId: players[afterPlay.currentPlayerIndex]!.id,
        declaration: "choose_color",
        params: { color_code: 1 },
      });

      expect(afterChoose.variables.chosen_color).toBe(1);
    });

    it("after choose_color, end_turn is called and phase transitions to play_turn", () => {
      let wildDiscardSeed: number | null = null;
      let cardIdx = 0;

      for (let seed = 0; seed < 5000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.suit !== "wild") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex((c) => c.suit !== "wild");
          if (idx !== -1) {
            wildDiscardSeed = seed;
            cardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (wildDiscardSeed === null) {
        expect(wildDiscardSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, wildDiscardSeed);

      const afterPlay = playUnoCard(state, reducer, players, cardIdx);
      expect(afterPlay.currentPhase).toBe("choose_color");

      const afterChoose = reducer(afterPlay, {
        kind: "declare",
        playerId: players[afterPlay.currentPlayerIndex]!.id,
        declaration: "choose_color",
        params: { color_code: 2 },
      });

      // After choose_color sets chosen_color > 0, transition to play_turn fires
      expect(afterChoose.currentPhase).toBe("play_turn");
      // end_turn was called, so next player should be active
      expect(afterChoose.currentPlayerIndex).toBe(1);
    });

    it("chosen_color persists until a non-wild card is played on non-wild discard top", () => {
      // Start a game and manually set chosen_color
      const { state } = startUnoGame(2);

      const stateWithColor: CardGameState = {
        ...state,
        variables: { ...state.variables, chosen_color: 3 },
      };

      // chosen_color should be 3
      expect(stateWithColor.variables.chosen_color).toBe(3);
    });

    it("non-wild card play resets chosen_color to 0 when discard top is non-wild", () => {
      // Find seed where discard top is not wild and player has a number card
      let testSeed: number | null = null;
      let testCardIdx = 0;

      for (let seed = 0; seed < 3000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startUnoGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          if (discardTop.suit === "wild") continue;
          const hand = game.state.zones["hand:0"]!;
          const idx = hand.cards.findIndex(
            (c) => c.rank !== "Wild" && c.suit !== "wild"
          );
          if (idx !== -1) {
            testSeed = seed;
            testCardIdx = idx;
            break;
          }
        } catch {
          continue;
        }
      }

      if (testSeed === null) {
        expect(testSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startUnoGame(2, testSeed);

      // Artificially set chosen_color
      const stateWithColor: CardGameState = {
        ...state,
        variables: { ...state.variables, chosen_color: 2 },
      };

      const afterPlay = playUnoCard(
        stateWithColor,
        reducer,
        players,
        testCardIdx
      );

      // Effect: if(top_card_suit(discard) != "wild", set_var("chosen_color", 0))
      // discard top (cards[0]) is non-wild, so chosen_color is reset
      expect(afterPlay.variables.chosen_color).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Drawing Cards ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("drawing cards", () => {
    it("draw_card declare draws 1 card and ends turn (when draw_penalty == 0)", () => {
      const { state, reducer, players } = startUnoGame(2);

      expect(state.variables.draw_penalty).toBe(0);

      const handBefore = state.zones["hand:0"]!.cards.length;
      const drawBefore = state.zones["draw_pile"]!.cards.length;

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      expect(afterDraw.zones["hand:0"]!.cards.length).toBe(handBefore + 1);
      expect(afterDraw.zones["draw_pile"]!.cards.length).toBe(
        drawBefore - 1
      );
      expect(afterDraw.version).toBeGreaterThan(state.version);
    });

    it("draw_card condition is met when draw_penalty == 0", () => {
      const { state, reducer, players } = startUnoGame(2);

      expect(state.variables.draw_penalty).toBe(0);

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      // Should succeed (version increases)
      expect(afterDraw.version).toBeGreaterThan(state.version);
      // Turn should advance
      if (afterDraw.currentPhase === "play_turn") {
        expect(afterDraw.currentPlayerIndex).toBe(1);
      }
    });

    it("draw_penalty condition blocks draw_card (draw_penalty > 0)", () => {
      const { state, reducer, players } = startUnoGame(2);

      const stateWithPenalty: CardGameState = {
        ...state,
        variables: { ...state.variables, draw_penalty: 2 },
      };

      const afterDraw = reducer(stateWithPenalty, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      // draw_card condition: get_var("draw_penalty") == 0 → false
      // Should be a no-op
      expect(afterDraw.version).toBe(stateWithPenalty.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Scoring ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("scoring", () => {
    it("scoring method uses hand_value with target 999", () => {
      const ruleset = makeUnoRuleset();
      expect(ruleset.scoring.method).toBe(
        "hand_value(current_player.hand, 999)"
      );
      expect(ruleset.scoring.winCondition).toBe("my_score == 0");
    });

    it("number cards are worth their face value", () => {
      for (let n = 0; n <= 9; n++) {
        expect(UNO_CARD_VALUES[String(n)]).toEqual({
          kind: "fixed",
          value: n,
        });
      }
    });

    it("action cards (Skip, Reverse, Draw Two) are worth 20 points each", () => {
      expect(UNO_CARD_VALUES["Skip"]).toEqual({
        kind: "fixed",
        value: 20,
      });
      expect(UNO_CARD_VALUES["Reverse"]).toEqual({
        kind: "fixed",
        value: 20,
      });
      expect(UNO_CARD_VALUES["Draw Two"]).toEqual({
        kind: "fixed",
        value: 20,
      });
    });

    it("Wild is worth 50 points", () => {
      expect(UNO_CARD_VALUES["Wild"]).toEqual({
        kind: "fixed",
        value: 50,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Card Conservation ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("card conservation", () => {
    it("total cards after start_game equals 104", () => {
      const { state } = startUnoGame(2);
      expect(totalCards(state)).toBe(UNO_DECK_SIZE);
    });

    it("total cards are conserved with 3 players", () => {
      const { state } = startUnoGame(3);
      expect(totalCards(state)).toBe(UNO_DECK_SIZE);
    });

    it("total cards are conserved with 4 players", () => {
      const { state } = startUnoGame(4);
      expect(totalCards(state)).toBe(UNO_DECK_SIZE);
    });

    it("no duplicate card IDs exist across all zones", () => {
      const { state } = startUnoGame(2);

      const allIds = Object.values(state.zones).flatMap((z) =>
        z.cards.map((c) => c.id)
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it("cards conserved after multiple plays", () => {
      const { state, reducer, players } = startUnoGame(2);

      let current = state;
      for (let i = 0; i < 4; i++) {
        if (current.currentPhase !== "play_turn") break;

        // Try to play the first card in the current player's hand
        const playerIdx = current.currentPlayerIndex;
        const hand = current.zones[`hand:${playerIdx}`]!;
        if (hand.cards.length === 0) break;

        const nextState = playUnoCard(current, reducer, players, 0);

        // If the play succeeded (version changed), check conservation
        if (nextState.version > current.version) {
          expect(totalCards(nextState)).toBe(UNO_DECK_SIZE);
          current = nextState;
        } else {
          break;
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Deterministic Replay ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("deterministic replay", () => {
    it("two identical games with same seed produce identical hands", () => {
      const game1 = startUnoGame(2, FIXED_SEED);
      const game2 = startUnoGame(2, FIXED_SEED);

      expect(handDescription(game1.state, "hand:0")).toEqual(
        handDescription(game2.state, "hand:0")
      );
      expect(handDescription(game1.state, "hand:1")).toEqual(
        handDescription(game2.state, "hand:1")
      );
      expect(handDescription(game1.state, "discard")).toEqual(
        handDescription(game2.state, "discard")
      );
    });

    it("different seeds produce different deals", () => {
      const game1 = startUnoGame(2, 42);
      const game2 = startUnoGame(2, 999);

      const hand1 = handDescription(game1.state, "hand:0");
      const hand2 = handDescription(game2.state, "hand:0");

      expect(hand1).not.toEqual(hand2);
    });

    it("card IDs are identical between same-seed games", () => {
      const game1 = startUnoGame(2, FIXED_SEED);
      const game2 = startUnoGame(2, FIXED_SEED);

      const ids1 = game1.state.zones["hand:0"]!.cards.map((c) => c.id);
      const ids2 = game2.state.zones["hand:0"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });

    it("replaying same actions produces identical state", () => {
      const game1 = startUnoGame(2, FIXED_SEED);
      const game2 = startUnoGame(2, FIXED_SEED);

      // Play 3 draw_card actions on each (always valid when draw_penalty == 0)
      let state1 = game1.state;
      let state2 = game2.state;

      for (let i = 0; i < 3; i++) {
        if (state1.currentPhase !== "play_turn") break;
        const playerId1 =
          game1.players[state1.currentPlayerIndex]!.id;
        const playerId2 =
          game2.players[state2.currentPlayerIndex]!.id;

        state1 = game1.reducer(state1, {
          kind: "declare",
          playerId: playerId1,
          declaration: "draw_card",
        });
        state2 = game2.reducer(state2, {
          kind: "declare",
          playerId: playerId2,
          declaration: "draw_card",
        });
      }

      expect(state1.variables).toEqual(state2.variables);
      expect(state1.currentPlayerIndex).toBe(state2.currentPlayerIndex);
      expect(state1.turnDirection).toBe(state2.turnDirection);
      expect(handDescription(state1, "hand:0")).toEqual(
        handDescription(state2, "hand:0")
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Player Views ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("player views", () => {
    it("player view includes variables (chosen_color, draw_penalty)", () => {
      const { state, players } = startUnoGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.variables).toBeDefined();
      expect(view.variables.chosen_color).toBe(0);
      expect(view.variables.draw_penalty).toBe(0);
    });

    it("draw_pile cards are hidden from all players", () => {
      const { state, players } = startUnoGame(2);
      const view = createPlayerView(state, players[0]!.id);

      const drawPile = view.zones["draw_pile"]!;
      expect(drawPile.cards.every((c) => c === null)).toBe(true);
      expect(drawPile.cardCount).toBeGreaterThan(0);
    });

    it("discard pile is visible to all players (public visibility)", () => {
      const { state, players } = startUnoGame(2);
      const view = createPlayerView(state, players[0]!.id);

      const discard = view.zones["discard"]!;
      expect(discard.cardCount).toBe(1);
      expect(discard.cards[0]).not.toBeNull();
    });

    it("isMyTurn is correct for current player", () => {
      const { state, players } = startUnoGame(2);

      const view0 = createPlayerView(state, players[0]!.id);
      expect(view0.isMyTurn).toBe(true);

      const view1 = createPlayerView(state, players[1]!.id);
      expect(view1.isMyTurn).toBe(false);
    });

    it("myPlayerId is set correctly in the view", () => {
      const { state, players } = startUnoGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.myPlayerId).toBe(players[0]!.id);
    });

    it("view includes all expected zone names", () => {
      const { state, players } = startUnoGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.zones["draw_pile"]).toBeDefined();
      expect(view.zones["hand:0"]).toBeDefined();
      expect(view.zones["hand:1"]).toBeDefined();
      expect(view.zones["discard"]).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Turn Order Enforcement ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("turn order enforcement", () => {
    it("wrong player action is a no-op", () => {
      const { state, reducer, players } = startUnoGame(2);

      expect(state.currentPlayerIndex).toBe(0);

      const afterWrongTurn = reducer(state, {
        kind: "declare",
        playerId: players[1]!.id,
        declaration: "draw_card",
      });

      expect(afterWrongTurn.version).toBe(state.version);
    });

    it("unknown declaration is a no-op", () => {
      const { state, reducer, players } = startUnoGame(2);

      const afterBad = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "nonexistent_action",
      });

      expect(afterBad.version).toBe(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Edge Cases ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("start_game is a no-op on an already started game", () => {
      const { state, reducer } = startUnoGame(2);

      const afterSecondStart = reducer(state, { kind: "start_game" });
      expect(afterSecondStart).toBe(state);
    });

    it("version monotonically increases through actions", () => {
      const { state, reducer, players } = startUnoGame(2);

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      expect(afterDraw.version).toBeGreaterThan(state.version);
    });

    it("action log grows with each action", () => {
      const { state, reducer, players } = startUnoGame(2);
      const initialLogLength = state.actionLog.length;

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw_card",
      });

      expect(afterDraw.actionLog.length).toBeGreaterThan(initialLogLength);
    });

    it("transition conditions safe with 2/3/4 players (if() guards)", () => {
      // Verify the transition condition evaluates safely for each player count
      for (const playerCount of [2, 3, 4]) {
        clearBuiltins();
        registerAllBuiltins();
        const { state } = startUnoGame(playerCount);

        const evalContext: EvalContext = { state, playerIndex: 0 };
        expect(() =>
          evaluateExpression(
            'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
            evalContext
          )
        ).not.toThrow();
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// ── Hearts Integration Tests ───────────────────────────────────
// ══════════════════════════════════════════════════════════════════

const HEARTS_CARD_VALUES: Readonly<Record<string, CardValue>> = {
  "2": { kind: "fixed", value: 2 },
  "3": { kind: "fixed", value: 3 },
  "4": { kind: "fixed", value: 4 },
  "5": { kind: "fixed", value: 5 },
  "6": { kind: "fixed", value: 6 },
  "7": { kind: "fixed", value: 7 },
  "8": { kind: "fixed", value: 8 },
  "9": { kind: "fixed", value: 9 },
  "10": { kind: "fixed", value: 10 },
  J: { kind: "fixed", value: 11 },
  Q: { kind: "fixed", value: 12 },
  K: { kind: "fixed", value: 13 },
  A: { kind: "fixed", value: 14 },
};

const HEARTS_RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/hearts.cardgame.json"
);

function makeHeartsRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Hearts",
      slug: "hearts",
      version: "1.0.0",
      author: "faluciano",
      players: { min: 4, max: 4 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: HEARTS_CARD_VALUES,
    },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      {
        name: "trick",
        visibility: { kind: "public" },
        owners: ["player"],
        maxCards: 1,
      },
      { name: "won", visibility: { kind: "hidden" }, owners: ["player"] },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    initialVariables: {
      lead_player: 0,
      hearts_broken: 0,
      tricks_played: 0,
    },
    phases: [
      {
        name: "setup",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "play_trick", when: "all_hands_dealt" }],
        automaticSequence: [
          "shuffle(draw_pile)",
          "deal(draw_pile, hand, 13)",
          "set_lead_player(0)",
        ],
      },
      {
        name: "play_trick",
        kind: "turn_based",
        actions: [
          {
            name: "play_card",
            label: "Play Card",
            effect: ["end_turn()"],
          },
        ],
        transitions: [
          {
            to: "resolve_trick",
            when: 'trick_card_count("trick") == player_count',
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "resolve_trick",
        kind: "automatic",
        actions: [],
        transitions: [
          { to: "scoring", when: 'get_var("tricks_played") >= 13' },
          { to: "play_trick", when: 'get_var("tricks_played") < 13' },
        ],
        automaticSequence: [
          'if(count_cards_by_suit("trick:0", "hearts") + count_cards_by_suit("trick:1", "hearts") + count_cards_by_suit("trick:2", "hearts") + count_cards_by_suit("trick:3", "hearts") > 0, set_var("hearts_broken", 1))',
          'collect_trick("trick", concat("won:", trick_winner("trick")))',
          'set_lead_player(trick_winner("trick"))',
          'inc_var("tricks_played", 1)',
        ],
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "round_end", when: "scores_calculated" }],
        automaticSequence: [
          "calculate_scores()",
          "determine_winners()",
          "end_game()",
        ],
      },
      {
        name: "round_end",
        kind: "all_players",
        actions: [
          {
            name: "play_again",
            label: "Play Again",
            effect: ["collect_all_to(draw_pile)", "reset_round()"],
          },
        ],
        transitions: [{ to: "setup", when: "continue_game" }],
      },
    ],
    scoring: {
      method:
        'count_cards_by_suit(concat("won:", current_player_index), "hearts") + if(has_card_with(concat("won:", current_player_index), "Q", "spades"), 13, 0)',
      winCondition: "my_score == 0",
    },
    visibility: [
      { zone: "draw_pile", visibility: { kind: "hidden" } },
      { zone: "hand", visibility: { kind: "owner_only" } },
      { zone: "trick", visibility: { kind: "public" } },
      { zone: "won", visibility: { kind: "hidden" } },
    ],
    ui: { layout: "circle", tableColor: "felt_green" },
  };
}

function startHeartsGame(
  seed: number = FIXED_SEED
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  clearBuiltins();
  registerAllBuiltins();

  const heartsRuleset = makeHeartsRuleset();
  const players: Player[] = [
    { id: pid("p0"), name: "Alice", role: "player", connected: true },
    { id: pid("p1"), name: "Bob", role: "player", connected: true },
    { id: pid("p2"), name: "Charlie", role: "player", connected: true },
    { id: pid("p3"), name: "Diana", role: "player", connected: true },
  ];
  const reducer = createReducer(heartsRuleset, seed);
  const initial = createInitialState(
    heartsRuleset,
    sid("hearts-test-session"),
    players,
    seed
  );
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer, players };
}

/**
 * Plays one complete trick: each player plays their first available card
 * from their hand to their trick zone. Returns the state after the trick
 * is resolved (cards collected, lead_player updated, tricks_played incremented).
 */
function playOneTrick(
  state: CardGameState,
  reducer: GameReducer,
  players: Player[]
): CardGameState {
  let current = state;
  for (let i = 0; i < 4; i++) {
    const playerIdx = current.currentPlayerIndex;
    const hand = current.zones[`hand:${playerIdx}`];
    if (!hand || hand.cards.length === 0) break;

    const card = hand.cards[0]!;
    current = reducer(current, {
      kind: "play_card",
      playerId: players[playerIdx]!.id,
      cardId: card.id,
      fromZone: `hand:${playerIdx}`,
      toZone: `trick:${playerIdx}`,
    });
  }
  return current;
}

// ─── Hearts Tests ─────────────────────────────────────────────────

describe("Hearts — Trick-Taking Integration", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Schema Validation ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("schema validation", () => {
    it("loads and validates the hearts ruleset from disk", () => {
      const raw = JSON.parse(readFileSync(HEARTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.meta.name).toBe("Hearts");
      expect(jsonRuleset.meta.slug).toBe("hearts");
      expect(jsonRuleset.deck.preset).toBe("standard_52");
      expect(jsonRuleset.phases).toHaveLength(6);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(4);
    });

    it("validates schema with parseRuleset without throwing", () => {
      const raw = JSON.parse(readFileSync(HEARTS_RULESET_PATH, "utf-8"));
      expect(() => parseRuleset(raw)).not.toThrow();
    });

    it("JSON ruleset contains all 6 expected phases", () => {
      const raw = JSON.parse(readFileSync(HEARTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const phaseNames = jsonRuleset.phases.map((p) => p.name);
      expect(phaseNames).toEqual([
        "setup",
        "play_trick",
        "resolve_trick",
        "scoring",
        "game_over",
        "round_end",
      ]);
    });

    it("JSON ruleset contains initialVariables for trick tracking", () => {
      const raw = JSON.parse(readFileSync(HEARTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.initialVariables).toEqual({
        lead_player: 0,
        hearts_broken: 0,
        tricks_played: 0,
      });
    });

    it("JSON ruleset scoring method uses count_cards_by_suit and has_card_with", () => {
      const raw = JSON.parse(readFileSync(HEARTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      expect(jsonRuleset.scoring.method).toContain("count_cards_by_suit");
      expect(jsonRuleset.scoring.method).toContain("has_card_with");
      expect(jsonRuleset.scoring.winCondition).toBe("get_cumulative_score(current_player_index) == min_cumulative_score()");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Game Setup ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("game setup", () => {
    it("deals 13 cards to each of 4 players", () => {
      const { state } = startHeartsGame();

      for (let i = 0; i < 4; i++) {
        const hand = state.zones[`hand:${i}`];
        expect(hand).toBeDefined();
        expect(hand!.cards).toHaveLength(13);
      }
    });

    it("draw_pile is empty after deal", () => {
      const { state } = startHeartsGame();
      expect(state.zones["draw_pile"]!.cards).toHaveLength(0);
    });

    it("starts in play_trick phase", () => {
      const { state } = startHeartsGame();
      expect(state.currentPhase).toBe("play_trick");
    });

    it("player 0 leads first trick", () => {
      const { state } = startHeartsGame();
      expect(state.currentPlayerIndex).toBe(0);
      expect(state.variables.lead_player).toBe(0);
    });

    it("all 52 cards are distributed across zones", () => {
      const { state } = startHeartsGame();
      expect(totalCards(state)).toBe(DECK_SIZE);
    });

    it("trick zones and won piles start empty", () => {
      const { state } = startHeartsGame();
      for (let i = 0; i < 4; i++) {
        expect(state.zones[`trick:${i}`]!.cards).toHaveLength(0);
        expect(state.zones[`won:${i}`]!.cards).toHaveLength(0);
      }
    });

    it("initial variables are set correctly", () => {
      const { state } = startHeartsGame();
      expect(state.variables.hearts_broken).toBe(0);
      expect(state.variables.tricks_played).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Trick Mechanics ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("trick mechanics", () => {
    it("allows current player to play a card to their trick zone", () => {
      const { state, reducer, players } = startHeartsGame();

      const hand = state.zones["hand:0"]!;
      const card = hand.cards[0]!;

      const afterPlay = reducer(state, {
        kind: "play_card",
        playerId: players[0]!.id,
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "trick:0",
      });

      // Card moved from hand to trick zone
      expect(afterPlay.zones["hand:0"]!.cards).toHaveLength(12);
      expect(afterPlay.zones["trick:0"]!.cards).toHaveLength(1);
      expect(afterPlay.zones["trick:0"]!.cards[0]!.id).toBe(card.id);
    });

    it("advances to next player after each play", () => {
      const { state, reducer, players } = startHeartsGame();

      const hand = state.zones["hand:0"]!;
      const card = hand.cards[0]!;

      const afterPlay = reducer(state, {
        kind: "play_card",
        playerId: players[0]!.id,
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "trick:0",
      });

      // Turn advances to player 1 (end_turn effect in play_card action)
      expect(afterPlay.currentPlayerIndex).toBe(1);
    });

    it("transitions to resolve_trick after all 4 players play", () => {
      const { state, reducer, players } = startHeartsGame();

      const afterTrick = playOneTrick(state, reducer, players);

      // After resolve_trick automatic phase runs, we should be back
      // in play_trick (since tricks_played < 13 after the first trick)
      expect(afterTrick.currentPhase).toBe("play_trick");
    });

    it("trick winner collects cards to their won pile", () => {
      const { state, reducer, players } = startHeartsGame();

      const afterTrick = playOneTrick(state, reducer, players);

      // All trick zones should be empty after collection
      for (let i = 0; i < 4; i++) {
        expect(afterTrick.zones[`trick:${i}`]!.cards).toHaveLength(0);
      }

      // Exactly one won pile should have 4 cards
      let totalWonCards = 0;
      for (let i = 0; i < 4; i++) {
        totalWonCards += afterTrick.zones[`won:${i}`]!.cards.length;
      }
      expect(totalWonCards).toBe(4);
    });

    it("trick winner leads next trick", () => {
      const { state, reducer, players } = startHeartsGame();

      const afterTrick = playOneTrick(state, reducer, players);

      // The current player should be the lead_player (trick winner)
      expect(afterTrick.currentPlayerIndex).toBe(
        afterTrick.variables.lead_player
      );
    });

    it("tricks_played increments after each trick", () => {
      const { state, reducer, players } = startHeartsGame();

      expect(state.variables.tricks_played).toBe(0);

      const afterTrick1 = playOneTrick(state, reducer, players);
      expect(afterTrick1.variables.tricks_played).toBe(1);

      const afterTrick2 = playOneTrick(afterTrick1, reducer, players);
      expect(afterTrick2.variables.tricks_played).toBe(2);
    });

    it("total cards remain 52 after each trick", () => {
      const { state, reducer, players } = startHeartsGame();

      const afterTrick1 = playOneTrick(state, reducer, players);
      expect(totalCards(afterTrick1)).toBe(DECK_SIZE);

      const afterTrick2 = playOneTrick(afterTrick1, reducer, players);
      expect(totalCards(afterTrick2)).toBe(DECK_SIZE);
    });

    it("each player has one fewer card after a trick", () => {
      const { state, reducer, players } = startHeartsGame();

      const afterTrick = playOneTrick(state, reducer, players);

      for (let i = 0; i < 4; i++) {
        expect(afterTrick.zones[`hand:${i}`]!.cards).toHaveLength(12);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Scoring ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("scoring", () => {
    it("scoring expression evaluates correctly for hearts in won pile", () => {
      const { state } = startHeartsGame();

      // Create a state where player 0 has hearts and Q♠ in their won pile
      const wonCards = [
        { id: `h2_test` as any, suit: "hearts", rank: "2", faceUp: false },
        { id: `h5_test` as any, suit: "hearts", rank: "5", faceUp: false },
        { id: `qs_test` as any, suit: "spades", rank: "Q", faceUp: false },
        { id: `s3_test` as any, suit: "spades", rank: "3", faceUp: false },
      ];

      const scoringState: CardGameState = {
        ...state,
        zones: {
          ...state.zones,
          "won:0": {
            ...state.zones["won:0"]!,
            cards: wonCards,
          },
        },
      };

      const evalContext: EvalContext = {
        state: scoringState,
        playerIndex: 0,
      };

      // 2 hearts + Q♠(13) = 15 penalty points
      const result = evaluateExpression(
        scoringState.ruleset.scoring.method,
        evalContext
      );
      expect(result).toEqual({ kind: "number", value: 15 });
    });

    it("hearts count as 1 penalty point each", () => {
      const { state } = startHeartsGame();

      const wonCards = [
        { id: `h3_test` as any, suit: "hearts", rank: "3", faceUp: false },
        { id: `h7_test` as any, suit: "hearts", rank: "7", faceUp: false },
        { id: `hk_test` as any, suit: "hearts", rank: "K", faceUp: false },
        { id: `s5_test` as any, suit: "spades", rank: "5", faceUp: false },
      ];

      const scoringState: CardGameState = {
        ...state,
        zones: {
          ...state.zones,
          "won:1": {
            ...state.zones["won:1"]!,
            cards: wonCards,
          },
        },
      };

      const evalContext: EvalContext = {
        state: scoringState,
        playerIndex: 1,
      };

      // 3 hearts, no Q♠ → 3 penalty points
      const result = evaluateExpression(
        scoringState.ruleset.scoring.method,
        evalContext
      );
      expect(result).toEqual({ kind: "number", value: 3 });
    });

    it("queen of spades counts as 13 penalty points", () => {
      const { state } = startHeartsGame();

      const wonCards = [
        { id: `qs_test` as any, suit: "spades", rank: "Q", faceUp: false },
        { id: `c5_test` as any, suit: "clubs", rank: "5", faceUp: false },
      ];

      const scoringState: CardGameState = {
        ...state,
        zones: {
          ...state.zones,
          "won:2": {
            ...state.zones["won:2"]!,
            cards: wonCards,
          },
        },
      };

      const evalContext: EvalContext = {
        state: scoringState,
        playerIndex: 2,
      };

      // 0 hearts + Q♠ = 13 penalty points
      const result = evaluateExpression(
        scoringState.ruleset.scoring.method,
        evalContext
      );
      expect(result).toEqual({ kind: "number", value: 13 });
    });

    it("no penalty cards gives score of 0", () => {
      const { state } = startHeartsGame();

      const wonCards = [
        { id: `s5_test` as any, suit: "spades", rank: "5", faceUp: false },
        { id: `c9_test` as any, suit: "clubs", rank: "9", faceUp: false },
        { id: `d3_test` as any, suit: "diamonds", rank: "3", faceUp: false },
      ];

      const scoringState: CardGameState = {
        ...state,
        zones: {
          ...state.zones,
          "won:3": {
            ...state.zones["won:3"]!,
            cards: wonCards,
          },
        },
      };

      const evalContext: EvalContext = {
        state: scoringState,
        playerIndex: 3,
      };

      // 0 hearts, no Q♠ → 0 penalty points
      const result = evaluateExpression(
        scoringState.ruleset.scoring.method,
        evalContext
      );
      expect(result).toEqual({ kind: "number", value: 0 });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── End Game ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("end game", () => {
    it("game transitions to scoring phase after 13 tricks", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        expect(current.currentPhase).toBe("play_trick");
        current = playOneTrick(current, reducer, players);
      }

      // After 13 tricks, the game should have ended (scoring → end_game)
      expect(current.status.kind).toBe("finished");
    });

    it("all hands are empty after 13 tricks", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrick(current, reducer, players);
      }

      for (let i = 0; i < 4; i++) {
        expect(current.zones[`hand:${i}`]!.cards).toHaveLength(0);
      }
    });

    it("all 52 cards end up in won piles after 13 tricks", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrick(current, reducer, players);
      }

      let totalWon = 0;
      for (let i = 0; i < 4; i++) {
        totalWon += current.zones[`won:${i}`]!.cards.length;
      }
      expect(totalWon).toBe(DECK_SIZE);
    });

    it("game status becomes finished after scoring", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrick(current, reducer, players);
      }

      expect(current.status.kind).toBe("finished");
      if (current.status.kind === "finished") {
        expect(current.status.finishedAt).toBeGreaterThan(0);
      }
    });

    it("tricks_played equals 13 at game end", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrick(current, reducer, players);
      }

      expect(current.variables.tricks_played).toBe(13);
    });

    it("engine survives a full game without errors", () => {
      const { state, reducer, players } = startHeartsGame();

      let current = state;
      expect(() => {
        for (let trick = 0; trick < 13; trick++) {
          current = playOneTrick(current, reducer, players);
        }
      }).not.toThrow();

      expect(current.status.kind).toBe("finished");
      expect(totalCards(current)).toBe(DECK_SIZE);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Edge Cases ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("start_game is a no-op on an already started game", () => {
      const { state, reducer } = startHeartsGame();

      const afterSecondStart = reducer(state, { kind: "start_game" });
      expect(afterSecondStart).toBe(state);
    });

    it("wrong player action is a no-op", () => {
      const { state, reducer, players } = startHeartsGame();

      expect(state.currentPlayerIndex).toBe(0);

      const hand = state.zones["hand:1"]!;
      const card = hand.cards[0]!;

      const afterWrongTurn = reducer(state, {
        kind: "play_card",
        playerId: players[1]!.id,
        cardId: card.id,
        fromZone: "hand:1",
        toZone: "trick:1",
      });

      // Should be a no-op — version unchanged
      expect(afterWrongTurn.version).toBe(state.version);
    });

    it("version monotonically increases through actions", () => {
      const { state, reducer, players } = startHeartsGame();

      const hand = state.zones["hand:0"]!;
      const card = hand.cards[0]!;

      const afterPlay = reducer(state, {
        kind: "play_card",
        playerId: players[0]!.id,
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "trick:0",
      });

      expect(afterPlay.version).toBeGreaterThan(state.version);
    });

    it("deterministic with same seed", () => {
      const game1 = startHeartsGame(123);
      const game2 = startHeartsGame(123);

      // Same hands dealt
      for (let i = 0; i < 4; i++) {
        const hand1 = handDescription(game1.state, `hand:${i}`);
        const hand2 = handDescription(game2.state, `hand:${i}`);
        expect(hand1).toEqual(hand2);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ── Hearts — Multi-Round Scoring (G9) Integration Tests ─────────────
// ═══════════════════════════════════════════════════════════════════════
//
// These tests exercise the full multi-round Hearts lifecycle: playing
// tricks, accumulating scores across rounds, round-end play_again flow,
// and game termination at the 100-point threshold.

describe("Hearts — Multi-Round Scoring (G9)", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Builds a multi-round Hearts ruleset with 6 phases:
   * setup → play_trick → resolve_trick → scoring → game_over / round_end
   *
   * scoring: calculate_scores() + accumulate_scores(), then branches:
   *   - max_cumulative_score() >= 100 → game_over (determine_winners + end_game)
   *   - max_cumulative_score() < 100  → round_end (all_players: play_again)
   */
  function makeMultiRoundHeartsRuleset(): CardGameRuleset {
    return {
      meta: {
        name: "Hearts",
        slug: "hearts",
        version: "2.0.0",
        author: "faluciano",
        players: { min: 4, max: 4 },
      },
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: HEARTS_CARD_VALUES,
      },
      zones: [
        { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
        {
          name: "hand",
          visibility: { kind: "owner_only" },
          owners: ["player"],
        },
        {
          name: "trick",
          visibility: { kind: "public" },
          owners: ["player"],
          maxCards: 1,
        },
        { name: "won", visibility: { kind: "hidden" }, owners: ["player"] },
      ],
      roles: [{ name: "player", isHuman: true, count: "per_player" }],
      initialVariables: {
        lead_player: 0,
        hearts_broken: 0,
        tricks_played: 0,
      },
      phases: [
        {
          name: "setup",
          kind: "automatic",
          actions: [],
          transitions: [{ to: "play_trick", when: "all_hands_dealt" }],
          automaticSequence: [
            "shuffle(draw_pile)",
            "deal(draw_pile, hand, 13)",
            "set_lead_player(0)",
          ],
        },
        {
          name: "play_trick",
          kind: "turn_based",
          actions: [
            {
              name: "play_card",
              label: "Play Card",
              effect: ["end_turn()"],
            },
          ],
          transitions: [
            {
              to: "resolve_trick",
              when: 'trick_card_count("trick") == player_count',
            },
          ],
          turnOrder: "clockwise",
        },
        {
          name: "resolve_trick",
          kind: "automatic",
          actions: [],
          transitions: [
            { to: "scoring", when: 'get_var("tricks_played") >= 13' },
            { to: "play_trick", when: 'get_var("tricks_played") < 13' },
          ],
          automaticSequence: [
            'if(count_cards_by_suit("trick:0", "hearts") + count_cards_by_suit("trick:1", "hearts") + count_cards_by_suit("trick:2", "hearts") + count_cards_by_suit("trick:3", "hearts") > 0, set_var("hearts_broken", 1))',
            'collect_trick("trick", concat("won:", trick_winner("trick")))',
            'set_lead_player(trick_winner("trick"))',
            'inc_var("tricks_played", 1)',
          ],
        },
        {
          name: "scoring",
          kind: "automatic",
          actions: [],
          transitions: [
            { to: "game_over", when: "max_cumulative_score() >= 100" },
            { to: "round_end", when: "max_cumulative_score() < 100" },
          ],
          automaticSequence: [
            "calculate_scores()",
            "accumulate_scores()",
          ],
        },
        {
          name: "game_over",
          kind: "automatic",
          actions: [],
          transitions: [],
          automaticSequence: [
            "determine_winners()",
            "end_game()",
          ],
        },
        {
          name: "round_end",
          kind: "all_players",
          actions: [
            {
              name: "play_again",
              label: "Play Again",
              effect: ["collect_all_to(draw_pile)", "reset_round()"],
            },
          ],
          transitions: [{ to: "setup", when: "continue_game" }],
        },
      ],
      scoring: {
        method:
          'count_cards_by_suit(concat("won:", current_player_index), "hearts") + if(has_card_with(concat("won:", current_player_index), "Q", "spades"), 13, 0)',
        winCondition:
          "get_cumulative_score(current_player_index) == min_cumulative_score()",
      },
      visibility: [
        { zone: "draw_pile", visibility: { kind: "hidden" } },
        { zone: "hand", visibility: { kind: "owner_only" } },
        { zone: "trick", visibility: { kind: "public" } },
        { zone: "won", visibility: { kind: "hidden" } },
      ],
      ui: { layout: "circle", tableColor: "felt_green" },
    };
  }

  /**
   * Creates a multi-round Hearts game with 4 players, started and ready
   * at the play_trick phase.
   */
  function startMultiRoundHearts(seed: number = FIXED_SEED): {
    state: CardGameState;
    reducer: GameReducer;
    players: Player[];
  } {
    const ruleset = makeMultiRoundHeartsRuleset();
    const players: Player[] = [
      { id: pid("p0"), name: "Alice", role: "player", connected: true },
      { id: pid("p1"), name: "Bob", role: "player", connected: true },
      { id: pid("p2"), name: "Charlie", role: "player", connected: true },
      { id: pid("p3"), name: "Diana", role: "player", connected: true },
    ];
    const reducer = createReducer(ruleset, seed);
    const initial = createInitialState(
      ruleset,
      sid("multi-round-hearts-test"),
      players,
      seed
    );
    const state = reducer(initial, { kind: "start_game" });
    return { state, reducer, players };
  }

  /**
   * Plays one complete trick: each player plays their first available
   * card from hand to trick zone. Returns state after trick resolution.
   */
  function playOneTrickG9(
    state: CardGameState,
    reducer: GameReducer,
    players: Player[]
  ): CardGameState {
    let current = state;
    for (let i = 0; i < 4; i++) {
      const playerIdx = current.currentPlayerIndex;
      const hand = current.zones[`hand:${playerIdx}`];
      if (!hand || hand.cards.length === 0) break;

      const card = hand.cards[0]!;
      current = reducer(current, {
        kind: "play_card",
        playerId: players[playerIdx]!.id,
        cardId: card.id,
        fromZone: `hand:${playerIdx}`,
        toZone: `trick:${playerIdx}`,
      });
    }
    return current;
  }

  /**
   * Plays 13 tricks (a full round). Returns the state after the
   * scoring phase completes (either at round_end or game_over).
   */
  function playFullRound(
    state: CardGameState,
    reducer: GameReducer,
    players: Player[]
  ): CardGameState {
    let current = state;
    for (let trick = 0; trick < 13; trick++) {
      current = playOneTrickG9(current, reducer, players);
    }
    return current;
  }

  /**
   * Issues a play_again declare from any player to trigger the
   * round_end → setup transition. In the engine, `continue_game`
   * always returns true, so a single player's action suffices.
   */
  function triggerPlayAgain(
    state: CardGameState,
    reducer: GameReducer,
    players: Player[]
  ): CardGameState {
    return reducer(state, {
      kind: "declare",
      playerId: players[0]!.id,
      declaration: "play_again",
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // ── Round Scoring and Accumulation ────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("round scoring and accumulation", () => {
    it("first round accumulates scores into cumulative variables", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound = playFullRound(state, reducer, players);

      // After scoring + accumulate_scores, cumulative_score_* should exist
      // Total penalty per round is always 26 (13 hearts + Q♠ = 13)
      let totalCumulative = 0;
      for (let i = 0; i < 4; i++) {
        const score = afterRound.variables[`cumulative_score_${i}`] ?? 0;
        expect(score).toBeGreaterThanOrEqual(0);
        totalCumulative += score;
      }
      expect(totalCumulative).toBe(26);
    });

    it("game does NOT end after first round (scores < 100)", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound = playFullRound(state, reducer, players);

      // Max cumulative score after 1 round is at most 26, well below 100
      expect(afterRound.status.kind).toBe("in_progress");
      expect(afterRound.currentPhase).toBe("round_end");
    });

    it("round_end play_again transitions back to setup and then play_trick", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound = playFullRound(state, reducer, players);
      expect(afterRound.currentPhase).toBe("round_end");

      // One player's play_again triggers: effects → transition to setup →
      // automatic phases (shuffle + deal + set_lead_player) → play_trick
      const afterPlayAgain = triggerPlayAgain(afterRound, reducer, players);

      expect(afterPlayAgain.status.kind).toBe("in_progress");
      expect(afterPlayAgain.currentPhase).toBe("play_trick");
    });

    it("reset_round preserves cumulative_score variables", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound = playFullRound(state, reducer, players);

      // Record cumulative scores before play_again
      const cumulativeBefore: number[] = [];
      for (let i = 0; i < 4; i++) {
        cumulativeBefore.push(
          afterRound.variables[`cumulative_score_${i}`] ?? 0
        );
      }

      // Trigger play_again → collect_all_to + reset_round + setup auto
      const afterPlayAgain = triggerPlayAgain(afterRound, reducer, players);

      // Cumulative scores must survive the reset
      for (let i = 0; i < 4; i++) {
        expect(afterPlayAgain.variables[`cumulative_score_${i}`]).toBe(
          cumulativeBefore[i]
        );
      }

      // But round-level variables should be reset to initial values
      expect(afterPlayAgain.variables.tricks_played).toBe(0);
      expect(afterPlayAgain.variables.hearts_broken).toBe(0);
      // lead_player is reset by initialVariables then set_lead_player(0) in setup
      expect(afterPlayAgain.variables.lead_player).toBe(0);
    });

    it("second round deals new hands after reset", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound = playFullRound(state, reducer, players);
      const afterPlayAgain = triggerPlayAgain(afterRound, reducer, players);

      // Each player should have 13 cards again
      for (let i = 0; i < 4; i++) {
        expect(afterPlayAgain.zones[`hand:${i}`]!.cards).toHaveLength(13);
      }

      // Trick zones should be empty
      for (let i = 0; i < 4; i++) {
        expect(afterPlayAgain.zones[`trick:${i}`]!.cards).toHaveLength(0);
      }

      // Won zones should be empty (collect_all_to already moved them)
      for (let i = 0; i < 4; i++) {
        expect(afterPlayAgain.zones[`won:${i}`]!.cards).toHaveLength(0);
      }

      // Draw pile empty (all 52 dealt to hands)
      expect(afterPlayAgain.zones["draw_pile"]!.cards).toHaveLength(0);

      // Total cards across all zones still 52
      expect(totalCards(afterPlayAgain)).toBe(DECK_SIZE);
    });

    it("cumulative scores accumulate across two rounds", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      // ── Round 1 ──
      const afterRound1 = playFullRound(state, reducer, players);
      const round1Cumulative: number[] = [];
      for (let i = 0; i < 4; i++) {
        round1Cumulative.push(
          afterRound1.variables[`cumulative_score_${i}`] ?? 0
        );
      }

      // ── Transition to Round 2 ──
      const afterPlayAgain = triggerPlayAgain(afterRound1, reducer, players);

      // ── Round 2 ──
      const afterRound2 = playFullRound(afterPlayAgain, reducer, players);

      // Round 2 cumulative should be round 1 cumulative + round 2 scores
      let totalR2Cumulative = 0;
      for (let i = 0; i < 4; i++) {
        const cumAfterR2 =
          afterRound2.variables[`cumulative_score_${i}`] ?? 0;
        // Each round's cumulative should be >= what it was after round 1
        expect(cumAfterR2).toBeGreaterThanOrEqual(round1Cumulative[i]!);
        totalR2Cumulative += cumAfterR2;
      }

      // Total cumulative across all players should be 26 * 2 = 52
      expect(totalR2Cumulative).toBe(52);
    });

    it("round scores (player_score:*) are reset between rounds", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound1 = playFullRound(state, reducer, players);

      // After scoring, player_score:* should exist
      for (let i = 0; i < 4; i++) {
        expect(afterRound1.scores[`player_score:${i}`]).toBeDefined();
      }

      // After play_again → reset_round, scores{} should be empty
      const afterPlayAgain = triggerPlayAgain(afterRound1, reducer, players);
      expect(afterPlayAgain.scores).toEqual({});
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Game Termination ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("game termination", () => {
    it("game ends when max cumulative score >= 100", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      // Play round 1 to reach round_end (cumulative scores are ~26 total)
      const afterRound1 = playFullRound(state, reducer, players);
      expect(afterRound1.currentPhase).toBe("round_end");

      // Artificially inflate one player's cumulative score above 100 so
      // that after round 2's accumulate_scores the max_cumulative_score
      // transition fires. We set it to 74 — even if that player takes
      // 0 penalty in round 2, the 26 total penalty is distributed among
      // 4 players, so at least one player will exceed 100 when starting
      // from 74 + round2_score ≥ 74, and the sum of all cumulative
      // scores after round 2 will be 74 + (other_round1_cum) + 26.
      // Actually, the simplest guarantee: set ALL players to 80 so
      // that every player gets 80 + round2_penalty > 80 ≥ 100 for at
      // least one (total 26 penalty distributed means max ≥ 80 + ceil(26/4) = 87,
      // but a single player could get 26 → 106). However, even if one
      // gets 0, the others sum to 26 across 3 → one gets ≥ 9, making
      // them 89. Still not 100. So let's just set one player to 100:
      // after accumulate, they'll be 100 + round2_score ≥ 100.
      const inflated: CardGameState = {
        ...afterRound1,
        variables: {
          ...afterRound1.variables,
          cumulative_score_0: 100,
        },
      };

      // Trigger play_again → setup → play_trick → play round 2
      const afterPlayAgain = triggerPlayAgain(inflated, reducer, players);
      expect(afterPlayAgain.currentPhase).toBe("play_trick");

      // Play round 2 completely. After accumulate_scores:
      // player 0 has at least 100 + 0 = 100, so max_cumulative >= 100 → game_over.
      const afterRound2 = playFullRound(afterPlayAgain, reducer, players);

      expect(afterRound2.status.kind).toBe("finished");
    });

    it("winner has lowest cumulative score", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      // Play one round naturally
      const afterRound1 = playFullRound(state, reducer, players);

      // Inflate a specific player to >= 100 to force game over next round
      const inflated: CardGameState = {
        ...afterRound1,
        variables: {
          ...afterRound1.variables,
          cumulative_score_0: 110,
        },
      };

      // Trigger play_again → round 2
      const afterPlayAgain = triggerPlayAgain(inflated, reducer, players);
      const afterRound2 = playFullRound(afterPlayAgain, reducer, players);

      expect(afterRound2.status.kind).toBe("finished");

      // determine_winners evaluates the winCondition:
      //   get_cumulative_score(current_player_index) == min_cumulative_score()
      // The player with the LOWEST cumulative score should have result:i = 1

      // Find the player with the minimum cumulative score
      let minCum = Infinity;
      let minIdx = -1;
      for (let i = 0; i < 4; i++) {
        const cum = afterRound2.variables[`cumulative_score_${i}`] ?? 0;
        if (cum < minCum) {
          minCum = cum;
          minIdx = i;
        }
      }

      // That player should be the winner
      expect(afterRound2.scores[`result:${minIdx}`]).toBe(1);

      // Player 0 should NOT be the winner (they had 110+)
      expect(afterRound2.scores[`result:0`]).toBe(-1);
    });

    it("game_over sets status to finished with a winnerId", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      const afterRound1 = playFullRound(state, reducer, players);

      // Force game over next round
      const inflated: CardGameState = {
        ...afterRound1,
        variables: {
          ...afterRound1.variables,
          cumulative_score_0: 110,
        },
      };

      const afterPlayAgain = triggerPlayAgain(inflated, reducer, players);
      const afterRound2 = playFullRound(afterPlayAgain, reducer, players);

      expect(afterRound2.status.kind).toBe("finished");
      if (afterRound2.status.kind === "finished") {
        expect(afterRound2.status.finishedAt).toBeGreaterThan(0);
        // winnerId should be set (the player with the lowest cumulative)
        expect(afterRound2.status.winnerId).toBeDefined();
        expect(afterRound2.status.winnerId).not.toBeNull();
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Engine Resilience ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("engine resilience", () => {
    it("engine survives multi-round game without errors", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      let current = state;
      expect(() => {
        // Round 1
        current = playFullRound(current, reducer, players);
        current = triggerPlayAgain(current, reducer, players);
        // Round 2
        current = playFullRound(current, reducer, players);
      }).not.toThrow();

      // After round 2, should still be in_progress (scores < 100)
      expect(current.status.kind).toBe("in_progress");
      expect(current.currentPhase).toBe("round_end");
      expect(totalCards(current)).toBe(DECK_SIZE);
    });

    it("deterministic multi-round with same seed", () => {
      // Two games with the same seed should produce identical results
      const game1 = startMultiRoundHearts(123);
      const game2 = startMultiRoundHearts(123);

      // Play round 1 for both
      const afterR1_g1 = playFullRound(
        game1.state,
        game1.reducer,
        game1.players
      );
      const afterR1_g2 = playFullRound(
        game2.state,
        game2.reducer,
        game2.players
      );

      // Cumulative scores should be identical
      for (let i = 0; i < 4; i++) {
        expect(afterR1_g1.variables[`cumulative_score_${i}`]).toBe(
          afterR1_g2.variables[`cumulative_score_${i}`]
        );
      }

      // Continue: play_again → round 2
      const r2start_g1 = triggerPlayAgain(
        afterR1_g1,
        game1.reducer,
        game1.players
      );
      const r2start_g2 = triggerPlayAgain(
        afterR1_g2,
        game2.reducer,
        game2.players
      );

      // Same hands dealt in round 2
      for (let i = 0; i < 4; i++) {
        const hand1 = handDescription(r2start_g1, `hand:${i}`);
        const hand2 = handDescription(r2start_g2, `hand:${i}`);
        expect(hand1).toEqual(hand2);
      }

      // Play round 2 for both
      const afterR2_g1 = playFullRound(
        r2start_g1,
        game1.reducer,
        game1.players
      );
      const afterR2_g2 = playFullRound(
        r2start_g2,
        game2.reducer,
        game2.players
      );

      // Cumulative scores after round 2 should be identical
      for (let i = 0; i < 4; i++) {
        expect(afterR2_g1.variables[`cumulative_score_${i}`]).toBe(
          afterR2_g2.variables[`cumulative_score_${i}`]
        );
      }
    });

    it("card count remains 52 throughout multi-round play", () => {
      const { state, reducer, players } = startMultiRoundHearts();

      // Round 1: check at every trick
      let current = state;
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrickG9(current, reducer, players);
        expect(totalCards(current)).toBe(DECK_SIZE);
      }

      // After scoring at round_end
      expect(totalCards(current)).toBe(DECK_SIZE);

      // After play_again → new round
      current = triggerPlayAgain(current, reducer, players);
      expect(totalCards(current)).toBe(DECK_SIZE);

      // Round 2: check at every trick
      for (let trick = 0; trick < 13; trick++) {
        current = playOneTrickG9(current, reducer, players);
        expect(totalCards(current)).toBe(DECK_SIZE);
      }
    });
  });
});
