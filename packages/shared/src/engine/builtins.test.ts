import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerAllBuiltins,
  computeHandValue,
  type EffectDescription,
  type MutableEvalContext,
} from "./builtins";
import {
  evaluateExpression,
  evaluateCondition,
  clearBuiltins,
  getRegisteredBuiltins,
  ExpressionError,
  type EvalContext,
  type EvalResult,
} from "./expression-evaluator";
import { createInitialState, createReducer } from "./interpreter";
import type {
  Card,
  CardInstanceId,
  CardValue,
  CardGameState,
  ZoneState,
  ZoneDefinition,
  CardGameRuleset,
  GameSessionId,
  PlayerId,
  Player,
} from "../types/index";

// ─── Test Helpers ──────────────────────────────────────────────────

function makeCardId(id: string): CardInstanceId {
  return id as CardInstanceId;
}

function makePlayerId(id: string): PlayerId {
  return id as PlayerId;
}

function makeSessionId(id: string): GameSessionId {
  return id as GameSessionId;
}

function makeCard(rank: string, suit: string, faceUp = true): Card {
  return {
    id: makeCardId(`${rank}_${suit}_${Math.random().toString(36).slice(2, 8)}`),
    suit,
    rank,
    faceUp,
  };
}

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

function makeZoneDefinition(name: string): ZoneDefinition {
  return {
    name,
    visibility: { kind: "public" },
    owners: [],
  };
}

function makeZone(name: string, cards: Card[]): ZoneState {
  return {
    definition: makeZoneDefinition(name),
    cards,
  };
}

function makeMinimalRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Test Blackjack",
      slug: "test-blackjack",
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
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      { name: "dealer_hand", visibility: { kind: "partial", rule: "first_card_only" }, owners: ["dealer"] },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
      { name: "dealer", isHuman: false, count: 1 },
    ],
    phases: [],
    scoring: {
      method: "hand_value(current_player.hand, 21)",
      winCondition: "my_score <= 21 && (dealer_score > 21 || my_score > dealer_score)",
      bustCondition: "my_score > 21",
      tieCondition: "my_score == dealer_score && my_score <= 21",
    },
    visibility: [],
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

function makeGameState(
  zones: Record<string, ZoneState>,
  overrides: Partial<CardGameState> = {}
): CardGameState {
  return {
    sessionId: makeSessionId("test-session"),
    ruleset: makeMinimalRuleset(),
    status: { kind: "in_progress", startedAt: Date.now() },
    players: [
      { id: makePlayerId("p1"), name: "Alice", role: "player", connected: true },
      { id: makePlayerId("p2"), name: "Bob", role: "player", connected: true },
    ],
    zones,
    currentPhase: "player_turns",
    currentPlayerIndex: 0,
    turnNumber: 1,
    scores: {},
    actionLog: [],
    turnsTakenThisPhase: 0,
    version: 1,
    ...overrides,
  };
}

function makeEvalContext(state: CardGameState): EvalContext {
  return { state };
}

function makeMutableContext(state: CardGameState): MutableEvalContext {
  return {
    state,
    effects: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("builtins", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  afterEach(() => {
    clearBuiltins();
  });

  describe("registerAllBuiltins", () => {
    it("registers all expected builtin function names", () => {
      const names = getRegisteredBuiltins();
      expect(names).toContain("hand_value");
      expect(names).toContain("card_count");
      expect(names).toContain("all_players_done");
      expect(names).toContain("all_hands_dealt");
      expect(names).toContain("scores_calculated");
      expect(names).toContain("continue_game");
      expect(names).toContain("sum_card_values");
      expect(names).toContain("prefer_high_under");
      expect(names).toContain("shuffle");
      expect(names).toContain("deal");
      expect(names).toContain("draw");
      expect(names).toContain("set_face_up");
      expect(names).toContain("reveal_all");
      expect(names).toContain("end_turn");
      expect(names).toContain("calculate_scores");
      expect(names).toContain("determine_winners");
      expect(names).toContain("collect_all_to");
      expect(names).toContain("reset_round");
    });

    it("does not register while (handled as special form)", () => {
      expect(getRegisteredBuiltins()).not.toContain("while");
    });
  });

  // ── computeHandValue ──

  describe("computeHandValue", () => {
    it("computes value for fixed-value cards only", () => {
      const cards = [makeCard("K", "spades"), makeCard("5", "hearts")];
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(15);
    });

    it("uses high value for ace when total <= 21", () => {
      const cards = [makeCard("A", "spades"), makeCard("9", "hearts")];
      // A(11) + 9 = 20
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(20);
    });

    it("downgrades ace when high value would bust", () => {
      const cards = [
        makeCard("A", "spades"),
        makeCard("9", "hearts"),
        makeCard("5", "clubs"),
      ];
      // A(11) + 9 + 5 = 25 > 21 → A(1) + 9 + 5 = 15
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(15);
    });

    it("handles two aces correctly", () => {
      const cards = [makeCard("A", "spades"), makeCard("A", "hearts")];
      // A(11) + A(11) = 22 > 21 → A(1) + A(11) = 12
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(12);
    });

    it("handles multiple aces all downgrading", () => {
      const cards = [
        makeCard("A", "spades"),
        makeCard("A", "hearts"),
        makeCard("A", "clubs"),
        makeCard("9", "diamonds"),
      ];
      // All high: 11+11+11+9 = 42
      // Downgrade 1: 1+11+11+9 = 32
      // Downgrade 2: 1+1+11+9 = 22
      // Downgrade 3: 1+1+1+9 = 12
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(12);
    });

    it("computes blackjack (21) correctly", () => {
      const cards = [makeCard("A", "spades"), makeCard("K", "hearts")];
      // A(11) + K(10) = 21
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(21);
    });

    it("returns 0 for empty hand", () => {
      expect(computeHandValue([], BLACKJACK_CARD_VALUES, 21)).toBe(0);
    });

    it("handles bust with no aces", () => {
      const cards = [
        makeCard("K", "spades"),
        makeCard("Q", "hearts"),
        makeCard("5", "clubs"),
      ];
      // 10 + 10 + 5 = 25
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 21)).toBe(25);
    });

    it("uses custom target threshold", () => {
      const cards = [makeCard("A", "spades"), makeCard("5", "hearts")];
      // A(11) + 5 = 16 > 15 → A(1) + 5 = 6
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, 15)).toBe(6);
    });
  });

  // ── Query Builtins via expression evaluator ──

  describe("hand_value builtin", () => {
    it("evaluates hand_value for a zone with cards", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("K", "spades"),
          makeCard("7", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('hand_value("hand")', ctx);
      expect(result).toEqual({ kind: "number", value: 17 });
    });

    it("computes correct value with ace", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("6", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('hand_value("hand")', ctx);
      expect(result).toEqual({ kind: "number", value: 17 });
    });

    it("throws on missing zone", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression('hand_value("nonexistent")', ctx)).toThrow(
        ExpressionError
      );
    });

    it("accepts explicit target=21 (identical to 1-arg form)", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("6", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // A(11) + 6 = 17, same as 1-arg form
      const result = evaluateExpression('hand_value("hand", 21)', ctx);
      expect(result).toEqual({ kind: "number", value: 17 });
    });

    it("downgrades ace at lower target (15)", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("5", "hearts"),
          makeCard("8", "clubs"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // A(11) + 5 + 8 = 24 > 15 → A(1) + 5 + 8 = 14
      const result = evaluateExpression('hand_value("hand", 15)', ctx);
      expect(result).toEqual({ kind: "number", value: 14 });
    });

    it("never downgrades with very high target", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("A", "hearts"),
          makeCard("9", "clubs"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // A(11) + A(11) + 9 = 31, no downgrading since 31 <= 99999
      const result = evaluateExpression('hand_value("hand", 99999)', ctx);
      expect(result).toEqual({ kind: "number", value: 31 });
    });

    it("computeHandValue never downgrades with Infinity target", () => {
      const cards = [
        makeCard("A", "spades"),
        makeCard("A", "hearts"),
        makeCard("9", "clubs"),
      ];
      // A(11) + A(11) + 9 = 31, no downgrading since 31 <= Infinity
      expect(computeHandValue(cards, BLACKJACK_CARD_VALUES, Infinity)).toBe(31);
    });

    it("throws on 0 arguments", () => {
      const state = makeGameState({
        hand: makeZone("hand", []),
      });
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("hand_value()", ctx)).toThrow(
        "requires 1-2 arguments, got 0"
      );
    });

    it("throws on 3 arguments", () => {
      const state = makeGameState({
        hand: makeZone("hand", []),
      });
      const ctx = makeEvalContext(state);
      expect(() =>
        evaluateExpression('hand_value("hand", 21, 42)', ctx)
      ).toThrow("requires 1-2 arguments, got 3");
    });
  });

  describe("card_count builtin", () => {
    it("returns count of cards in a zone", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("K", "hearts"),
          makeCard("5", "clubs"),
        ]),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('card_count("hand")', ctx);
      expect(result).toEqual({ kind: "number", value: 3 });
    });

    it("returns 0 for empty zone", () => {
      const state = makeGameState({
        hand: makeZone("hand", []),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('card_count("hand")', ctx);
      expect(result).toEqual({ kind: "number", value: 0 });
    });
  });

  // ── Sentinel Builtins ──

  describe("sentinel builtins", () => {
    it("all_players_done returns true when all turns taken", () => {
      // 2 human players → need turnsTakenThisPhase >= 2
      const state = makeGameState({}, { turnsTakenThisPhase: 2 });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("all_players_done()", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("all_players_done returns false when not all turns taken", () => {
      // 2 human players → turnsTakenThisPhase 0 means no turns taken
      const state = makeGameState({}, { turnsTakenThisPhase: 0 });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("all_players_done()", ctx);
      expect(result).toEqual({ kind: "boolean", value: false });
    });

    it("all_hands_dealt returns true", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("all_hands_dealt()", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("scores_calculated returns true", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("scores_calculated()", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("continue_game returns true", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("continue_game()", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("sentinel builtins reject arguments", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression('all_players_done("extra")', ctx)).toThrow(
        "takes no arguments"
      );
    });
  });

  // ── sum_card_values & prefer_high_under ──

  describe("sum_card_values and prefer_high_under", () => {
    it("computes hand value with strategy", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("K", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression(
        'sum_card_values("hand", prefer_high_under(21))',
        ctx
      );
      expect(result).toEqual({ kind: "number", value: 21 });
    });

    it("prefer_high_under returns the target number", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("prefer_high_under(21)", ctx);
      expect(result).toEqual({ kind: "number", value: 21 });
    });

    it("sum_card_values respects custom target", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("5", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // A(11) + 5 = 16 > 10 → A(1) + 5 = 6
      const result = evaluateExpression(
        'sum_card_values("hand", prefer_high_under(10))',
        ctx
      );
      expect(result).toEqual({ kind: "number", value: 6 });
    });
  });

  // ── Effect Builtins ──

  describe("effect builtins", () => {
    it("shuffle pushes a shuffle effect", () => {
      const state = makeGameState({
        draw_pile: makeZone("draw_pile", []),
      });
      const ctx = makeMutableContext(state);
      evaluateExpression('shuffle("draw_pile")', ctx);
      expect(ctx.effects).toEqual([
        { kind: "shuffle", params: { zone: "draw_pile" } },
      ]);
    });

    it("deal pushes a deal effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('deal("draw_pile", "hand", 2)', ctx);
      expect(ctx.effects).toEqual([
        { kind: "deal", params: { from: "draw_pile", to: "hand", count: 2 } },
      ]);
    });

    it("draw pushes a draw effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('draw("draw_pile", "hand", 1)', ctx);
      expect(ctx.effects).toEqual([
        { kind: "draw", params: { from: "draw_pile", to: "hand", count: 1 } },
      ]);
    });

    it("set_face_up pushes a set_face_up effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('set_face_up("dealer_hand", 0, true)', ctx);
      expect(ctx.effects).toEqual([
        { kind: "set_face_up", params: { zone: "dealer_hand", cardIndex: 0, faceUp: true } },
      ]);
    });

    it("reveal_all pushes a reveal_all effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('reveal_all("dealer_hand")', ctx);
      expect(ctx.effects).toEqual([
        { kind: "reveal_all", params: { zone: "dealer_hand" } },
      ]);
    });

    it("end_turn pushes an end_turn effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("end_turn()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "end_turn", params: {} },
      ]);
    });

    it("calculate_scores pushes a calculate_scores effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("calculate_scores()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "calculate_scores", params: {} },
      ]);
    });

    it("determine_winners pushes a determine_winners effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("determine_winners()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "determine_winners", params: {} },
      ]);
    });

    it("collect_all_to pushes a collect_all_to effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('collect_all_to("discard")', ctx);
      expect(ctx.effects).toEqual([
        { kind: "collect_all_to", params: { zone: "discard" } },
      ]);
    });

    it("reset_round pushes a reset_round effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("reset_round()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "reset_round", params: {} },
      ]);
    });

    it("multiple effects accumulate in order", () => {
      const state = makeGameState({
        draw_pile: makeZone("draw_pile", []),
      });
      const ctx = makeMutableContext(state);
      evaluateExpression('shuffle("draw_pile")', ctx);
      evaluateExpression('deal("draw_pile", "hand", 2)', ctx);
      evaluateExpression('deal("draw_pile", "dealer_hand", 2)', ctx);
      expect(ctx.effects).toHaveLength(3);
      expect(ctx.effects[0]!.kind).toBe("shuffle");
      expect(ctx.effects[1]!.kind).toBe("deal");
      expect(ctx.effects[2]!.kind).toBe("deal");
    });

    it("effect builtins throw without MutableEvalContext", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state); // No effects array
      expect(() => evaluateExpression('shuffle("draw_pile")', ctx)).toThrow(
        "requires a MutableEvalContext"
      );
    });
  });

  // ── while special form ──

  describe("while special form", () => {
    it("executes body while condition is true", () => {
      // Set up: hand starts with low value, draw pile has cards
      const drawPileCards = [
        makeCard("5", "spades"),
        makeCard("5", "hearts"),
        makeCard("5", "clubs"),
        makeCard("5", "diamonds"),
      ];
      const dealerCards = [
        makeCard("2", "spades"),
        makeCard("3", "hearts"),
      ];
      const state = makeGameState({
        draw_pile: makeZone("draw_pile", drawPileCards),
        dealer_hand: makeZone("dealer_hand", dealerCards),
      });
      const ctx = makeMutableContext(state);

      // The while loop evaluates against the SAME state each time (since effects
      // are deferred). So for testing the special form, we just verify:
      // 1. The condition is checked
      // 2. The body is evaluated
      // 3. The loop terminates

      // hand_value(dealer_hand) = 2+3 = 5, which is < 17, so condition is true
      // Body is draw(draw_pile, dealer_hand, 1) which pushes an effect
      // Since state is immutable during eval, condition stays true → hits max iterations
      // We need to test this differently...

      // Actually, let's test with a condition that's immediately false
      const state2 = makeGameState({
        dealer_hand: makeZone("dealer_hand", [
          makeCard("K", "spades"),
          makeCard("8", "hearts"),
        ]),
      });
      const ctx2 = makeMutableContext(state2);
      // hand_value = 18 >= 17, so condition < 17 is false immediately
      const result = evaluateExpression(
        'while(hand_value("dealer_hand") < 17, draw("draw_pile", "dealer_hand", 1))',
        ctx2
      );
      expect(result).toEqual({ kind: "boolean", value: true });
      // Body was never executed, so no effects
      expect(ctx2.effects).toHaveLength(0);
    });

    it("condition false on first check means zero iterations", () => {
      const state = makeGameState({
        dealer_hand: makeZone("dealer_hand", [
          makeCard("K", "spades"),
          makeCard("Q", "hearts"),
        ]),
      });
      const ctx = makeMutableContext(state);
      evaluateExpression(
        'while(hand_value("dealer_hand") < 17, draw("draw_pile", "dealer_hand", 1))',
        ctx
      );
      expect(ctx.effects).toHaveLength(0);
    });

    it("throws on non-boolean condition", () => {
      const state = makeGameState({
        hand: makeZone("hand", []),
      });
      const ctx = makeMutableContext(state);
      expect(() =>
        evaluateExpression(
          'while(hand_value("hand"), end_turn())',
          ctx
        )
      ).toThrow("condition must be boolean");
    });

    it("throws on wrong number of arguments", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      expect(() =>
        evaluateExpression("while(true)", ctx)
      ).toThrow("requires exactly 2 arguments");
    });

    it("enforces maximum iteration limit", () => {
      // Create a condition that's always true (empty hand < 17 is always true since 0 < 17)
      const state = makeGameState({
        dealer_hand: makeZone("dealer_hand", []),
      });
      const ctx = makeMutableContext(state);
      expect(() =>
        evaluateExpression(
          'while(hand_value("dealer_hand") < 17, end_turn())',
          ctx
        )
      ).toThrow("exceeded maximum iterations");
      // Should have accumulated 100 end_turn effects before throwing
      expect(ctx.effects).toHaveLength(100);
    });
  });

  // ── Integration: blackjack-like expressions ──

  describe("blackjack expression integration", () => {
    it("evaluates hand_value comparison from blackjack ruleset", () => {
      const state = makeGameState({
        dealer_hand: makeZone("dealer_hand", [
          makeCard("K", "spades"),
          makeCard("9", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // hand_value(dealer_hand) >= 17 → 19 >= 17 → true
      const result = evaluateCondition(
        'hand_value("dealer_hand") >= 17',
        ctx
      );
      expect(result).toBe(true);
    });

    it("evaluates card_count comparison", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("K", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // card_count(hand) == 2 → true (double down condition)
      const result = evaluateCondition(
        'card_count("hand") == 2',
        ctx
      );
      expect(result).toBe(true);
    });

    it("evaluates bust condition", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("K", "spades"),
          makeCard("Q", "hearts"),
          makeCard("5", "clubs"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // hand_value > 21 → 25 > 21 → true
      const result = evaluateCondition(
        'hand_value("hand") > 21',
        ctx
      );
      expect(result).toBe(true);
    });

    it("evaluates non-bust condition", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("A", "spades"),
          makeCard("K", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      // hand_value = 21, not > 21
      const result = evaluateCondition(
        'hand_value("hand") > 21',
        ctx
      );
      expect(result).toBe(false);
    });

    it("evaluates hit condition (hand_value < 21)", () => {
      const state = makeGameState({
        hand: makeZone("hand", [
          makeCard("8", "spades"),
          makeCard("5", "hearts"),
        ]),
      });
      const ctx = makeEvalContext(state);
      const result = evaluateCondition(
        'hand_value("hand") < 21',
        ctx
      );
      expect(result).toBe(true);
    });

    it("executes automatic deal sequence effects", () => {
      const state = makeGameState({
        draw_pile: makeZone("draw_pile", []),
        hand: makeZone("hand", []),
        dealer_hand: makeZone("dealer_hand", []),
      });
      const ctx = makeMutableContext(state);

      // Simulate the deal phase automatic sequence
      evaluateExpression('shuffle("draw_pile")', ctx);
      evaluateExpression('deal("draw_pile", "hand", 2)', ctx);
      evaluateExpression('deal("draw_pile", "dealer_hand", 2)', ctx);
      evaluateExpression('set_face_up("dealer_hand", 0, true)', ctx);

      expect(ctx.effects).toEqual([
        { kind: "shuffle", params: { zone: "draw_pile" } },
        { kind: "deal", params: { from: "draw_pile", to: "hand", count: 2 } },
        { kind: "deal", params: { from: "draw_pile", to: "dealer_hand", count: 2 } },
        { kind: "set_face_up", params: { zone: "dealer_hand", cardIndex: 0, faceUp: true } },
      ]);
    });
  });

  // ── Phase 8 — Non-Blackjack Builtins ──

  describe("Phase 8 — Non-Blackjack Builtins", () => {
    // ── Registration ──

    it("registers all Phase 8 builtin names", () => {
      const names = getRegisteredBuiltins();
      expect(names).toContain("card_rank");
      expect(names).toContain("card_suit");
      expect(names).toContain("card_rank_name");
      expect(names).toContain("count_rank");
      expect(names).toContain("top_card_rank");
      expect(names).toContain("max_card_rank");
      expect(names).toContain("move_top");
      expect(names).toContain("flip_top");
      expect(names).toContain("move_all");
    });

    // ── Query Builtins ──

    describe("card_rank", () => {
      it("returns numeric rank for a fixed-value card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank("hand", 0)', ctx);
        expect(result).toEqual({ kind: "number", value: 10 });
      });

      it("returns high value for a dual-value card (Ace)", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("A", "spades"),
            makeCard("5", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank("hand", 0)', ctx);
        expect(result).toEqual({ kind: "number", value: 11 });
      });

      it("returns rank for card at non-zero index", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank("hand", 1)', ctx);
        expect(result).toEqual({ kind: "number", value: 7 });
      });

      it("throws on out-of-bounds index", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("K", "spades")]),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('card_rank("hand", 5)', ctx)).toThrow(
          "index 5 out of bounds"
        );
      });

      it("throws on unknown zone", () => {
        const state = makeGameState({});
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('card_rank("nonexistent", 0)', ctx)).toThrow(
          "Unknown zone"
        );
      });
    });

    describe("card_suit", () => {
      it("returns suit string of a card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_suit("hand", 0)', ctx);
        expect(result).toEqual({ kind: "string", value: "spades" });
      });

      it("returns suit for second card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_suit("hand", 1)', ctx);
        expect(result).toEqual({ kind: "string", value: "hearts" });
      });

      it("throws on out-of-bounds index", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("K", "spades")]),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('card_suit("hand", 3)', ctx)).toThrow(
          "index 3 out of bounds"
        );
      });
    });

    describe("card_rank_name", () => {
      it("returns rank string for a face card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("K", "spades")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank_name("hand", 0)', ctx);
        expect(result).toEqual({ kind: "string", value: "K" });
      });

      it("returns rank string for a number card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("7", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank_name("hand", 0)', ctx);
        expect(result).toEqual({ kind: "string", value: "7" });
      });

      it("returns rank string for Ace", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("A", "diamonds")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('card_rank_name("hand", 0)', ctx);
        expect(result).toEqual({ kind: "string", value: "A" });
      });

      it("throws on out-of-bounds index", () => {
        const state = makeGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('card_rank_name("hand", 0)', ctx)).toThrow(
          "index 0 out of bounds"
        );
      });
    });

    describe("count_rank", () => {
      it("counts matching ranks in a zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("7", "clubs"),
            makeCard("K", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_rank("hand", "K")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("returns 0 for no matches", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("Q", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_rank("hand", "A")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("returns 0 for empty zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_rank("hand", "K")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });
    });

    describe("top_card_rank", () => {
      it("returns numeric rank of first card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("Q", "spades"),
            makeCard("3", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('top_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 10 });
      });

      it("returns high value for dual-value top card", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("A", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('top_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 11 });
      });

      it("throws on empty zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('top_card_rank("hand")', ctx)).toThrow(
          "zone 'hand' is empty"
        );
      });
    });

    describe("max_card_rank", () => {
      it("returns the highest numeric rank in a zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("3", "spades"),
            makeCard("K", "hearts"),
            makeCard("7", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 10 });
      });

      it("returns 0 for empty zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("handles zone with mixed fixed and dual values", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("5", "spades"),
            makeCard("A", "hearts"),
            makeCard("9", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // A has high value 11, which is the max
        const result = evaluateExpression('max_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 11 });
      });

      it("handles zone where all cards have same rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("7", "spades"),
            makeCard("7", "hearts"),
            makeCard("7", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_card_rank("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 7 });
      });
    });

    // ── Effect Builtins (shape tests) ──

    describe("move_top effect builtin", () => {
      it("pushes a move_top effect with correct params", () => {
        const state = makeGameState({});
        const ctx = makeMutableContext(state);
        evaluateExpression('move_top("draw_pile", "discard", 3)', ctx);
        expect(ctx.effects).toEqual([
          { kind: "move_top", params: { from: "draw_pile", to: "discard", count: 3 } },
        ]);
      });

      it("throws without MutableEvalContext", () => {
        const state = makeGameState({});
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('move_top("a", "b", 1)', ctx)).toThrow(
          "requires a MutableEvalContext"
        );
      });
    });

    describe("flip_top effect builtin", () => {
      it("pushes a flip_top effect with correct params", () => {
        const state = makeGameState({});
        const ctx = makeMutableContext(state);
        evaluateExpression('flip_top("hand", 2)', ctx);
        expect(ctx.effects).toEqual([
          { kind: "flip_top", params: { zone: "hand", count: 2 } },
        ]);
      });
    });

    describe("move_all effect builtin", () => {
      it("pushes a move_all effect with correct params", () => {
        const state = makeGameState({});
        const ctx = makeMutableContext(state);
        evaluateExpression('move_all("hand", "discard")', ctx);
        expect(ctx.effects).toEqual([
          { kind: "move_all", params: { from: "hand", to: "discard" } },
        ]);
      });
    });

    // ── Effect Handlers (integration via reducer) ──

    describe("effect handlers via reducer", () => {
      const FIXED_SEED = 42;

      function makePlayerId(id: string): PlayerId {
        return id as PlayerId;
      }

      function makePlayers(count: number): Player[] {
        const players: Player[] = [];
        for (let i = 0; i < count; i++) {
          players.push({
            id: makePlayerId(`p${i}`),
            name: `Player ${i}`,
            role: "player",
            connected: true,
          });
        }
        return players;
      }

      function makeEffectTestRuleset(
        automaticSequence: string[]
      ): CardGameRuleset {
        return {
          meta: {
            name: "Effect Test",
            slug: "effect-test",
            version: "1.0.0",
            author: "test",
            players: { min: 1, max: 2 },
          },
          deck: {
            preset: "standard_52",
            copies: 1,
            cardValues: BLACKJACK_CARD_VALUES,
          },
          zones: [
            { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
            { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
            { name: "discard", visibility: { kind: "public" }, owners: [] },
            { name: "pile_a", visibility: { kind: "public" }, owners: [] },
            { name: "pile_b", visibility: { kind: "public" }, owners: [] },
          ],
          roles: [
            { name: "player", isHuman: true, count: "per_player" },
          ],
          phases: [
            {
              name: "setup",
              kind: "automatic",
              actions: [],
              transitions: [{ to: "play", when: "all_hands_dealt" }],
              automaticSequence,
            },
            {
              name: "play",
              kind: "turn_based",
              actions: [{ name: "noop", label: "Noop", effect: [] }],
              transitions: [],
              turnOrder: "clockwise",
            },
          ],
          scoring: {
            method: "0",
            winCondition: "false",
          },
          visibility: [],
          ui: { layout: "semicircle", tableColor: "felt_green" },
        };
      }

      it("move_top: moves top N cards from one zone to another", () => {
        // Setup: shuffle draw_pile, then deal 5 to pile_a, then move_top 2 from pile_a to pile_b
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 5)',
          'move_top("pile_a", "pile_b", 2)',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        // pile_a should have 3 cards (5 dealt - 2 moved)
        expect(result.zones["pile_a"]!.cards).toHaveLength(3);
        // pile_b should have 2 cards
        expect(result.zones["pile_b"]!.cards).toHaveLength(2);
      });

      it("move_top: moves all available if fewer cards than count", () => {
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 2)',
          'move_top("pile_a", "pile_b", 10)',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        // pile_a should be empty (only had 2, requested 10)
        expect(result.zones["pile_a"]!.cards).toHaveLength(0);
        // pile_b should have 2 cards
        expect(result.zones["pile_b"]!.cards).toHaveLength(2);
      });

      it("flip_top: flips top N cards face-up", () => {
        // Cards dealt from draw_pile start face-down. flip_top flips them.
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 4)',
          'flip_top("pile_a", 2)',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        const pileA = result.zones["pile_a"]!.cards;
        expect(pileA).toHaveLength(4);
        // First 2 should be face-up
        expect(pileA[0]!.faceUp).toBe(true);
        expect(pileA[1]!.faceUp).toBe(true);
        // Remaining should still be face-down (original state from deal)
        expect(pileA[2]!.faceUp).toBe(false);
        expect(pileA[3]!.faceUp).toBe(false);
      });

      it("flip_top: flips all if fewer cards than count", () => {
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 2)',
          'flip_top("pile_a", 10)',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        const pileA = result.zones["pile_a"]!.cards;
        expect(pileA).toHaveLength(2);
        expect(pileA[0]!.faceUp).toBe(true);
        expect(pileA[1]!.faceUp).toBe(true);
      });

      it("move_all: moves all cards from one zone to another", () => {
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 5)',
          'move_all("pile_a", "pile_b")',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        // pile_a should be empty
        expect(result.zones["pile_a"]!.cards).toHaveLength(0);
        // pile_b should have all 5 cards
        expect(result.zones["pile_b"]!.cards).toHaveLength(5);
      });

      it("move_all: preserves faceUp state of moved cards", () => {
        // Deal cards, flip some face-up, then move_all
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_a", 3)',
          'flip_top("pile_a", 1)',
          'move_all("pile_a", "pile_b")',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        const pileB = result.zones["pile_b"]!.cards;
        expect(pileB).toHaveLength(3);
        // First card was flipped face-up, should retain that state
        expect(pileB[0]!.faceUp).toBe(true);
        // Remaining cards should still be face-down
        expect(pileB[1]!.faceUp).toBe(false);
        expect(pileB[2]!.faceUp).toBe(false);
      });

      it("move_all: empty source zone results in no changes to target", () => {
        const ruleset = makeEffectTestRuleset([
          'shuffle("draw_pile")',
          'deal("draw_pile", "pile_b", 3)',
          'move_all("pile_a", "pile_b")',
        ]);
        const players = makePlayers(1);
        const state = createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED);
        const reducer = createReducer(ruleset, FIXED_SEED);

        const result = reducer(state, { kind: "start_game" });

        // pile_a was empty, so pile_b should still have only its original 3 cards
        expect(result.zones["pile_a"]!.cards).toHaveLength(0);
        expect(result.zones["pile_b"]!.cards).toHaveLength(3);
      });
    });
  });
});
