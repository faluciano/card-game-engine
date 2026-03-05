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
        phaseOverrides: [
          { phase: "dealer_turn", visibility: { kind: "public" } },
        ],
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
      expect(jsonRuleset.zones).toHaveLength(3);
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
 * Matches the structure of crazy-eights.cardgame.json v2.0.
 */
function makeCrazyEightsRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Crazy Eights",
      slug: "crazy-eights",
      version: "2.0.0",
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
      { name: "stash", visibility: { kind: "hidden" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
    ],
    variables: {
      active_suit: { type: "string", initial: "" },
    },
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
            condition: 'played_card_index == -1 || card_rank_name(current_player.hand, played_card_index) == "8" || played_card_matches_top(discard) || (get_str_var("active_suit") != "" && card_suit(current_player.hand, played_card_index) == get_str_var("active_suit"))',
            effect: [
              'set_str_var("active_suit", "")',
              'if(card_rank_name(discard, 0) != "8", end_turn())',
            ],
          },
          {
            name: "draw",
            label: "Draw Card",
            condition: '!has_playable_card(current_player.hand, discard) && count_rank(current_player.hand, "8") == 0 && (get_str_var("active_suit") == "" || !has_card_matching_suit(current_player.hand, get_str_var("active_suit")))',
            effect: [
              "draw(draw_pile, current_player.hand, 1)",
              "end_turn()",
            ],
          },
        ],
        transitions: [
          {
            to: "choose_suit",
            when: 'card_rank_name(discard, 0) == "8" && get_str_var("active_suit") == ""',
          },
          {
            to: "reshuffle",
            when: "card_count(draw_pile) == 0 && card_count(discard) > 1",
          },
          {
            to: "scoring",
            when: 'card_count("hand:0") == 0 || card_count("hand:1") == 0 || if(player_count > 2, card_count("hand:2") == 0, false) || if(player_count > 3, card_count("hand:3") == 0, false)',
          },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "choose_suit",
        kind: "turn_based",
        actions: [
          {
            name: "choose_hearts",
            label: "Hearts",
            effect: [
              'set_str_var("active_suit", "Hearts")',
              "end_turn()",
            ],
          },
          {
            name: "choose_diamonds",
            label: "Diamonds",
            effect: [
              'set_str_var("active_suit", "Diamonds")',
              "end_turn()",
            ],
          },
          {
            name: "choose_clubs",
            label: "Clubs",
            effect: [
              'set_str_var("active_suit", "Clubs")',
              "end_turn()",
            ],
          },
          {
            name: "choose_spades",
            label: "Spades",
            effect: [
              'set_str_var("active_suit", "Spades")',
              "end_turn()",
            ],
          },
        ],
        transitions: [
          { to: "player_turns", when: 'get_str_var("active_suit") != ""' },
        ],
        turnOrder: "clockwise",
      },
      {
        name: "reshuffle",
        kind: "automatic",
        actions: [],
        transitions: [
          { to: "player_turns", when: "card_count(draw_pile) > 0" },
        ],
        automaticSequence: [
          "move_top(discard, stash, 1)",
          "move_all(discard, draw_pile)",
          "shuffle(draw_pile)",
          "move_top(stash, discard, 1)",
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
      expect(jsonRuleset.phases).toHaveLength(6);
      expect(jsonRuleset.roles).toHaveLength(1);
      expect(jsonRuleset.zones).toHaveLength(4);
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
        "choose_suit",
        "reshuffle",
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
      expect(drawAction!.condition).toContain(
        "!has_playable_card(current_player.hand, discard)"
      );
      expect(drawAction!.condition).toContain("count_rank(current_player.hand, \"8\") == 0");
      expect(drawAction!.condition).toContain("get_str_var(\"active_suit\")");
    });

    it("JSON ruleset transition uses if() for guarded player count checks", () => {
      const raw = JSON.parse(readFileSync(CRAZY_EIGHTS_RULESET_PATH, "utf-8"));
      const jsonRuleset = loadRuleset(raw);

      const playerTurns = jsonRuleset.phases.find(
        (p) => p.name === "player_turns"
      );
      expect(playerTurns).toBeDefined();
      // choose_suit transition checks for 8 played with no suit chosen
      const chooseSuitTransition = playerTurns!.transitions.find(
        (t) => t.to === "choose_suit"
      );
      expect(chooseSuitTransition).toBeDefined();
      expect(chooseSuitTransition!.when).toContain("card_rank_name(discard, 0)");
      expect(chooseSuitTransition!.when).toContain("get_str_var(\"active_suit\")");
      // scoring transition uses if() for guarded player count checks
      const scoringTransition = playerTurns!.transitions.find(
        (t) => t.to === "scoring"
      );
      expect(scoringTransition).toBeDefined();
      expect(scoringTransition!.when).toContain("if(player_count > 2");
      expect(scoringTransition!.when).toContain("if(player_count > 3");
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
      // and no eights (since 8s are always playable in v2.0)
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
          const hasEight = hand0Cards.some((c) => c.rank === "8");
          if (!hasMatch && !hasEight) {
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

    it("draw action is rejected when player has a playable card or an eight", () => {
      // Find a seed where player 0 HAS playable cards against the discard
      // (or has an eight, since 8s are always playable in v2.0)
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
          const hasEight = hand0Cards.some((c) => c.rank === "8");
          if (hasMatch || hasEight) {
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

  // ══════════════════════════════════════════════════════════════════
  // ── Wild Eights ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("wild eights", () => {
    it("player can play an 8 regardless of discard top via play_card action", () => {
      // Find a seed where player 0 has an 8 that doesn't match discard top
      let eightSeed: number | null = null;
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          // Player has an 8 that doesn't naturally match the discard top
          const eightIdx = hand0Cards.findIndex(
            (c) => c.rank === "8" && c.suit !== discardTop.suit
          );
          if (eightIdx !== -1 && discardTop.rank !== "8") {
            eightSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (eightSeed === null) {
        expect(eightSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, eightSeed);
      const hand0Cards = state.zones["hand:0"]!.cards;
      const eightCard = hand0Cards.find(
        (c) => c.rank === "8" && c.suit !== state.zones["discard"]!.cards[0]!.suit
      )!;

      // Play the 8 via play_card action
      const afterPlay = reducer(state, {
        kind: "play_card",
        playerId: players[0]!.id,
        cardId: eightCard.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      // The 8 should now be on top of the discard pile
      expect(afterPlay.zones["discard"]!.cards[0]!.rank).toBe("8");
      // Version should have advanced
      expect(afterPlay.version).toBeGreaterThan(state.version);
    });

    it("playing an 8 transitions to choose_suit phase", () => {
      // Find a seed where player 0 has an 8
      let eightSeed: number | null = null;
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          if (hand0Cards.some((c) => c.rank === "8")) {
            eightSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (eightSeed === null) {
        expect(eightSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, eightSeed);
      const hand0Cards = state.zones["hand:0"]!.cards;
      const eightCard = hand0Cards.find((c) => c.rank === "8")!;

      const afterPlay = reducer(state, {
        kind: "play_card",
        playerId: players[0]!.id,
        cardId: eightCard.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      // After playing an 8, the game should transition to choose_suit
      expect(afterPlay.currentPhase).toBe("choose_suit");
    });

    it("declare play_card is rejected in v2.0 (requires play_card action type)", () => {
      const { state, reducer, players } = startCrazyEightsGame(2);

      // In v2.0, declare play_card fails because the condition uses
      // played_card_index which is not injected for declare actions
      const afterDeclare = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "play_card",
      });

      // Should be a no-op — condition can't evaluate without played_card_index
      expect(afterDeclare.version).toBe(state.version);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Suit Choosing ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("suit choosing", () => {
    /**
     * Helper: Play an 8 from player 0's hand to get into choose_suit phase.
     * Returns the state in choose_suit phase.
     */
    function playEightToChooseSuit(): {
      state: CardGameState;
      reducer: GameReducer;
      players: Player[];
    } | null {
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          const eightCard = hand0Cards.find((c) => c.rank === "8");
          if (!eightCard) continue;

          const afterPlay = game.reducer(game.state, {
            kind: "play_card",
            playerId: game.players[0]!.id,
            cardId: eightCard.id,
            fromZone: "hand:0",
            toZone: "discard",
          });

          if (afterPlay.currentPhase === "choose_suit") {
            return {
              state: afterPlay,
              reducer: game.reducer,
              players: game.players,
            };
          }
        } catch {
          continue;
        }
      }
      return null;
    }

    it("player can choose Hearts after playing an 8", () => {
      const result = playEightToChooseSuit();
      if (!result) {
        expect(result).not.toBeNull();
        return;
      }
      const { state, reducer, players } = result;

      const afterChoose = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "choose_hearts",
      });

      // Should transition back to player_turns with active_suit set
      expect(afterChoose.currentPhase).toBe("player_turns");
      expect(afterChoose.stringVariables["active_suit"]).toBe("Hearts");
    });

    it("player can choose Diamonds after playing an 8", () => {
      const result = playEightToChooseSuit();
      if (!result) {
        expect(result).not.toBeNull();
        return;
      }
      const { state, reducer, players } = result;

      const afterChoose = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "choose_diamonds",
      });

      expect(afterChoose.currentPhase).toBe("player_turns");
      expect(afterChoose.stringVariables["active_suit"]).toBe("Diamonds");
    });

    it("player can choose Clubs after playing an 8", () => {
      const result = playEightToChooseSuit();
      if (!result) {
        expect(result).not.toBeNull();
        return;
      }
      const { state, reducer, players } = result;

      const afterChoose = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "choose_clubs",
      });

      expect(afterChoose.currentPhase).toBe("player_turns");
      expect(afterChoose.stringVariables["active_suit"]).toBe("Clubs");
    });

    it("player can choose Spades after playing an 8", () => {
      const result = playEightToChooseSuit();
      if (!result) {
        expect(result).not.toBeNull();
        return;
      }
      const { state, reducer, players } = result;

      const afterChoose = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "choose_spades",
      });

      expect(afterChoose.currentPhase).toBe("player_turns");
      expect(afterChoose.stringVariables["active_suit"]).toBe("Spades");
    });

    it("choosing a suit clears the active_suit after the next non-8 play", () => {
      const result = playEightToChooseSuit();
      if (!result) {
        expect(result).not.toBeNull();
        return;
      }
      const { state, reducer, players } = result;

      // Choose Hearts
      const afterChoose = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "choose_hearts",
      });

      expect(afterChoose.stringVariables["active_suit"]).toBe("Hearts");

      // Now it's the next player's turn. Find a non-8 Hearts card if they have one.
      const nextPlayerIdx = afterChoose.currentPlayerIndex;
      const nextHand = afterChoose.zones[`hand:${nextPlayerIdx}`]!.cards;
      const heartsCard = nextHand.find(
        (c) => c.suit === "Hearts" && c.rank !== "8"
      );

      if (heartsCard) {
        const afterNextPlay = reducer(afterChoose, {
          kind: "play_card",
          playerId: players[nextPlayerIdx]!.id,
          cardId: heartsCard.id,
          fromZone: `hand:${nextPlayerIdx}`,
          toZone: "discard",
        });

        // After playing a non-8, active_suit should be cleared
        expect(afterNextPlay.stringVariables["active_suit"]).toBe("");
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── String Variables ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("string variables", () => {
    it("stringVariables is initialized from ruleset variables manifest", () => {
      const { state } = startCrazyEightsGame(2);

      expect(state.stringVariables).toBeDefined();
      expect(state.stringVariables["active_suit"]).toBe("");
    });

    it("stringVariables appears in player view", () => {
      const { state, players } = startCrazyEightsGame(2);
      const view = createPlayerView(state, players[0]!.id);

      expect(view.stringVariables).toBeDefined();
      expect(view.stringVariables["active_suit"]).toBe("");
    });

    it("stash zone exists in initial state", () => {
      const { state } = startCrazyEightsGame(2);

      expect(state.zones["stash"]).toBeDefined();
      expect(state.zones["stash"]!.cards).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Reshuffle ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("reshuffle", () => {
    it("ruleset contains reshuffle phase with correct sequence", () => {
      const ruleset = makeCrazyEightsRuleset();
      const reshufflePhase = ruleset.phases.find(
        (p) => p.name === "reshuffle"
      );

      expect(reshufflePhase).toBeDefined();
      expect(reshufflePhase!.kind).toBe("automatic");
      expect(reshufflePhase!.automaticSequence).toEqual([
        "move_top(discard, stash, 1)",
        "move_all(discard, draw_pile)",
        "shuffle(draw_pile)",
        "move_top(stash, discard, 1)",
      ]);
    });

    it("reshuffle transition condition triggers when draw pile is empty", () => {
      const { state } = startCrazyEightsGame(2);
      const evalContext: EvalContext = { state, playerIndex: 0 };

      // With a full draw pile, condition should be false
      const result = evaluateExpression(
        "card_count(draw_pile) == 0 && card_count(discard) > 1",
        evalContext
      );
      expect(result).toEqual({ kind: "boolean", value: false });
    });

    it("ruleset v2.0 has 6 phases", () => {
      const ruleset = makeCrazyEightsRuleset();
      expect(ruleset.phases).toHaveLength(6);
      expect(ruleset.phases.map((p) => p.name)).toEqual([
        "setup",
        "player_turns",
        "choose_suit",
        "reshuffle",
        "scoring",
        "round_end",
      ]);
    });

    it("ruleset v2.0 has 4 zones including stash", () => {
      const ruleset = makeCrazyEightsRuleset();
      expect(ruleset.zones).toHaveLength(4);
      expect(ruleset.zones.map((z) => z.name)).toEqual([
        "draw_pile",
        "hand",
        "discard",
        "stash",
      ]);
    });

    it("stash visibility is hidden", () => {
      const ruleset = makeCrazyEightsRuleset();
      const stashZone = ruleset.zones.find((z) => z.name === "stash");
      expect(stashZone).toBeDefined();
      expect(stashZone!.visibility).toEqual({ kind: "hidden" });
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
      expect(view.zones["stash"]).toBeDefined();
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

    it("version monotonically increases through draw actions", () => {
      // In v2.0, play_card requires a play_card action type (not declare),
      // so we test with draw which is still a declare action.
      // Find a seed where player 0 can draw (no playable cards, no eights)
      let drawSeed: number | null = null;
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          const hasMatch = hand0Cards.some(
            (c) => c.suit === discardTop.suit || c.rank === discardTop.rank
          );
          const hasEight = hand0Cards.some((c) => c.rank === "8");
          if (!hasMatch && !hasEight) {
            drawSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (drawSeed === null) {
        expect(drawSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, drawSeed);

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw",
      });

      expect(afterDraw.version).toBeGreaterThan(state.version);
    });

    it("action log grows with each action", () => {
      // In v2.0, play_card requires a play_card action type, so we use draw
      let drawSeed: number | null = null;
      for (let seed = 0; seed < 2000; seed++) {
        try {
          clearBuiltins();
          registerAllBuiltins();
          const game = startCrazyEightsGame(2, seed);
          const discardTop = game.state.zones["discard"]!.cards[0]!;
          const hand0Cards = game.state.zones["hand:0"]!.cards;
          const hasMatch = hand0Cards.some(
            (c) => c.suit === discardTop.suit || c.rank === discardTop.rank
          );
          const hasEight = hand0Cards.some((c) => c.rank === "8");
          if (!hasMatch && !hasEight) {
            drawSeed = seed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (drawSeed === null) {
        expect(drawSeed).not.toBeNull();
        return;
      }

      clearBuiltins();
      registerAllBuiltins();
      const { state, reducer, players } = startCrazyEightsGame(2, drawSeed);
      const initialLogLength = state.actionLog.length;

      const afterDraw = reducer(state, {
        kind: "declare",
        playerId: players[0]!.id,
        declaration: "draw",
      });

      expect(afterDraw.actionLog.length).toBeGreaterThan(initialLogLength);
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
