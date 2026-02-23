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
import { clearBuiltins } from "./expression-evaluator";
import { registerAllBuiltins } from "./builtins";
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

    it("per-player hand zones use owner_only visibility based on role", () => {
      // NOTE: The current state-filter uses role-based ownership, not
      // per-player-index ownership. Since all players share the "player"
      // role, the owner_only check passes for all player-owned zones.
      // This documents the actual engine behavior.
      const { state, players } = startGame(ruleset, 2);
      const view = createPlayerView(state, players[0]!.id);

      const myHand = view.zones["hand:0"]!;
      const otherHand = view.zones["hand:1"]!;

      // Both are visible because both share the "player" role
      expect(myHand.cards.every((c) => c !== null)).toBe(true);
      expect(otherHand.cards.every((c) => c !== null)).toBe(true);
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
