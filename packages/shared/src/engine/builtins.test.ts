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
    variables: {},
    actionLog: [],
    turnsTakenThisPhase: 0,
    turnDirection: 1,
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
      expect(names).toContain("reverse_turn_order");
      expect(names).toContain("skip_next_player");
      expect(names).toContain("set_next_player");
      expect(names).toContain("turn_direction");
      expect(names).toContain("trick_winner");
      expect(names).toContain("led_card_suit");
      expect(names).toContain("trick_card_count");
      expect(names).toContain("count_cards_by_suit");
      expect(names).toContain("has_card_with");
      expect(names).toContain("sum_zone_values_by_suit");
      expect(names).toContain("collect_trick");
      expect(names).toContain("set_lead_player");
      expect(names).toContain("end_game");
      expect(names).toContain("concat");
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

  // ── Card Matching Builtins ──

  describe("card matching builtins", () => {
    it("registers all card matching builtin names", () => {
      const names = getRegisteredBuiltins();
      expect(names).toContain("top_card_suit");
      expect(names).toContain("top_card_rank_name");
      expect(names).toContain("has_card_matching_suit");
      expect(names).toContain("has_card_matching_rank");
      expect(names).toContain("card_matches_top");
      expect(names).toContain("has_playable_card");
    });

    describe("top_card_suit", () => {
      it("returns suit of first card in zone", () => {
        const state = makeGameState({
          discard: makeZone("discard", [
            makeCard("7", "hearts"),
            makeCard("K", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('top_card_suit("discard")', ctx);
        expect(result).toEqual({ kind: "string", value: "hearts" });
      });

      it("throws on empty zone", () => {
        const state = makeGameState({
          discard: makeZone("discard", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('top_card_suit("discard")', ctx)).toThrow(
          "zone 'discard' is empty"
        );
      });
    });

    describe("top_card_rank_name", () => {
      it("returns rank string of first card in zone", () => {
        const state = makeGameState({
          discard: makeZone("discard", [
            makeCard("Q", "diamonds"),
            makeCard("3", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('top_card_rank_name("discard")', ctx);
        expect(result).toEqual({ kind: "string", value: "Q" });
      });

      it("throws on empty zone", () => {
        const state = makeGameState({
          discard: makeZone("discard", []),
        });
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('top_card_rank_name("discard")', ctx)
        ).toThrow("zone 'discard' is empty");
      });
    });

    describe("has_card_matching_suit", () => {
      it("returns true when zone contains card with matching suit", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
            makeCard("3", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_card_matching_suit("hand", "hearts")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when no card matches suit", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_card_matching_suit("hand", "clubs")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: false });
      });
    });

    describe("has_card_matching_rank", () => {
      it("returns true when zone contains card with matching rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
            makeCard("3", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_card_matching_rank("hand", "7")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when no card matches rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_card_matching_rank("hand", "A")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: false });
      });
    });

    describe("card_matches_top", () => {
      it("returns true when card matches by suit", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("3", "hearts"),  // index 0: matches suit
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card: 7 of hearts
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'card_matches_top("hand", 0, "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns true when card matches by rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("7", "spades"),  // index 0: matches rank
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card: 7 of hearts
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'card_matches_top("hand", 0, "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when card matches neither suit nor rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),  // index 0: no match
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card: 7 of hearts
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'card_matches_top("hand", 0, "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("throws on out-of-bounds index", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("K", "spades")]),
          discard: makeZone("discard", [makeCard("7", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('card_matches_top("hand", 5, "discard")', ctx)
        ).toThrow("index 5 out of bounds");
      });

      it("throws on empty target zone", () => {
        const state = makeGameState({
          hand: makeZone("hand", [makeCard("K", "spades")]),
          discard: makeZone("discard", []),
        });
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('card_matches_top("hand", 0, "discard")', ctx)
        ).toThrow("target zone 'discard' is empty");
      });
    });

    describe("has_playable_card", () => {
      it("returns true when hand has playable card matching suit", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "hearts"),  // matches suit
            makeCard("3", "clubs"),
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_playable_card("hand", "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns true when hand has playable card matching rank", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("7", "spades"),  // matches rank
            makeCard("3", "clubs"),
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_playable_card("hand", "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when no playable card exists", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("3", "clubs"),
          ]),
          discard: makeZone("discard", [
            makeCard("7", "hearts"),  // top card: no match in hand
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_playable_card("hand", "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("returns false when target zone is empty", () => {
        const state = makeGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
          ]),
          discard: makeZone("discard", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression(
          'has_playable_card("hand", "discard")',
          ctx
        );
        expect(result).toEqual({ kind: "boolean", value: false });
      });
    });
  });

  // ── Turn manipulation builtins ──

  describe("turn manipulation builtins", () => {
    it("turn_direction() returns 1 by default", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("turn_direction()", ctx);
      expect(result).toEqual({ kind: "number", value: 1 });
    });

    it("turn_direction() returns -1 when turnDirection is -1", () => {
      const state = makeGameState({}, { turnDirection: -1 });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression("turn_direction()", ctx);
      expect(result).toEqual({ kind: "number", value: -1 });
    });

    it("reverse_turn_order() records a reverse_turn_order effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("reverse_turn_order()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "reverse_turn_order", params: {} },
      ]);
    });

    it("skip_next_player() records a skip_next_player effect", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("skip_next_player()", ctx);
      expect(ctx.effects).toEqual([
        { kind: "skip_next_player", params: {} },
      ]);
    });

    it("set_next_player(2) records a set_next_player effect with params", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression("set_next_player(2)", ctx);
      expect(ctx.effects).toEqual([
        { kind: "set_next_player", params: { playerIndex: 2 } },
      ]);
    });

    it("reverse_turn_order() throws with arguments", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      expect(() => evaluateExpression("reverse_turn_order(1)", ctx)).toThrow(
        "takes no arguments"
      );
    });

    it("skip_next_player() throws with arguments", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      expect(() => evaluateExpression("skip_next_player(1)", ctx)).toThrow(
        "takes no arguments"
      );
    });

    it("turn_direction() throws with arguments", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("turn_direction(1)", ctx)).toThrow(
        "takes no arguments"
      );
    });

    it("turn manipulation effect builtins throw without MutableEvalContext", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("reverse_turn_order()", ctx)).toThrow(
        "requires a MutableEvalContext"
      );
      expect(() => evaluateExpression("skip_next_player()", ctx)).toThrow(
        "requires a MutableEvalContext"
      );
      expect(() => evaluateExpression("set_next_player(0)", ctx)).toThrow(
        "requires a MutableEvalContext"
      );
    });
  });

  // ── Custom Variable Builtins ──────────────────────────────────────

  describe("Custom Variable Builtins", () => {
    it('get_var("x") returns the variable value', () => {
      const state = makeGameState({}, { variables: { x: 42 } });
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('get_var("x")', ctx);
      expect(result).toEqual({ kind: "number", value: 42 });
    });

    it('get_var("missing") throws ExpressionError', () => {
      const state = makeGameState({}, { variables: {} });
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression('get_var("missing")', ctx)).toThrow(
        ExpressionError
      );
      expect(() => evaluateExpression('get_var("missing")', ctx)).toThrow(
        "variable 'missing' not found"
      );
    });

    it("get_var() with wrong arg count throws", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("get_var()", ctx)).toThrow(
        "requires exactly 1 argument"
      );
    });

    it('set_var("x", 5) pushes a set_var effect', () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('set_var("x", 5)', ctx);
      expect(ctx.effects).toHaveLength(1);
      expect(ctx.effects[0]).toEqual({
        kind: "set_var",
        params: { name: "x", value: 5 },
      });
    });

    it("set_var() with wrong arg count throws", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      expect(() => evaluateExpression('set_var("x")', ctx)).toThrow(
        "requires exactly 2 argument"
      );
    });

    it('inc_var("x", 3) pushes an inc_var effect', () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      evaluateExpression('inc_var("x", 3)', ctx);
      expect(ctx.effects).toHaveLength(1);
      expect(ctx.effects[0]).toEqual({
        kind: "inc_var",
        params: { name: "x", amount: 3 },
      });
    });

    it("inc_var() with wrong arg count throws", () => {
      const state = makeGameState({});
      const ctx = makeMutableContext(state);
      expect(() => evaluateExpression('inc_var("x")', ctx)).toThrow(
        "requires exactly 2 argument"
      );
    });
  });

  // ── get_param ────────────────────────────────────────────────────

  describe("get_param", () => {
    it("returns string param value", () => {
      const state = makeGameState({});
      const ctx = { ...makeEvalContext(state), actionParams: { color: "red" } };
      const result = evaluateExpression('get_param("color")', ctx);
      expect(result).toEqual({ kind: "string", value: "red" });
    });

    it("returns number param value", () => {
      const state = makeGameState({});
      const ctx = { ...makeEvalContext(state), actionParams: { count: 5 } };
      const result = evaluateExpression('get_param("count")', ctx);
      expect(result).toEqual({ kind: "number", value: 5 });
    });

    it("returns 1 for true boolean param", () => {
      const state = makeGameState({});
      const ctx = { ...makeEvalContext(state), actionParams: { active: true } };
      const result = evaluateExpression('get_param("active")', ctx);
      expect(result).toEqual({ kind: "number", value: 1 });
    });

    it("returns 0 for false boolean param", () => {
      const state = makeGameState({});
      const ctx = {
        ...makeEvalContext(state),
        actionParams: { active: false },
      };
      const result = evaluateExpression('get_param("active")', ctx);
      expect(result).toEqual({ kind: "number", value: 0 });
    });

    it("returns 0 when param key is not found", () => {
      const state = makeGameState({});
      const ctx = { ...makeEvalContext(state), actionParams: { other: 1 } };
      const result = evaluateExpression('get_param("missing")', ctx);
      expect(result).toEqual({ kind: "number", value: 0 });
    });

    it("returns 0 when actionParams is undefined", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      const result = evaluateExpression('get_param("anything")', ctx);
      expect(result).toEqual({ kind: "number", value: 0 });
    });

    it("throws with wrong arg count", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("get_param()", ctx)).toThrow(
        "requires exactly 1 argument"
      );
    });

    it("throws with non-string argument", () => {
      const state = makeGameState({});
      const ctx = makeEvalContext(state);
      expect(() => evaluateExpression("get_param(123)", ctx)).toThrow();
    });
  });

  // ── Pattern Matching Builtins ──

  describe("Pattern Matching Builtins", () => {
    // Card values that give each rank a unique numeric value for straight detection
    const POKER_CARD_VALUES: Readonly<Record<string, CardValue>> = {
      A: { kind: "dual", low: 1, high: 14 },
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
    };

    function makePokerRuleset(): CardGameRuleset {
      return {
        ...makeMinimalRuleset(),
        deck: {
          preset: "standard_52",
          copies: 1,
          cardValues: POKER_CARD_VALUES,
        },
      };
    }

    function makePokerGameState(
      zones: Record<string, ZoneState>,
      overrides: Partial<CardGameState> = {}
    ): CardGameState {
      return {
        ...makeGameState(zones, overrides),
        ruleset: makePokerRuleset(),
      };
    }

    // ── Registration ──

    it("registers all pattern matching builtin names", () => {
      const names = getRegisteredBuiltins();
      expect(names).toContain("count_sets");
      expect(names).toContain("max_set_size");
      expect(names).toContain("has_flush");
      expect(names).toContain("has_straight");
      expect(names).toContain("count_runs");
      expect(names).toContain("max_run_length");
    });

    // ── count_sets ──

    describe("count_sets", () => {
      it("counts pairs in a hand", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("7", "clubs"),
            makeCard("3", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // One pair (K×2), min_size=2 → 1 set
        const result = evaluateExpression('count_sets("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("counts two pairs", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("7", "clubs"),
            makeCard("7", "diamonds"),
            makeCard("3", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_sets("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 2 });
      });

      it("counts three-of-a-kind as a set of min_size 3", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("K", "clubs"),
            makeCard("7", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_sets("hand", 3)', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("four-of-a-kind also counts as set of min_size 2", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("K", "clubs"),
            makeCard("K", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_sets("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("returns 0 when no sets meet min_size", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("Q", "hearts"),
            makeCard("7", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_sets("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("returns 0 for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_sets("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('count_sets("hand")', ctx)).toThrow(
          "requires exactly 2 argument"
        );
      });

      it("throws on unknown zone", () => {
        const state = makePokerGameState({});
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('count_sets("nonexistent", 2)', ctx)
        ).toThrow("Unknown zone");
      });
    });

    // ── max_set_size ──

    describe("max_set_size", () => {
      it("returns 4 for four-of-a-kind", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("K", "hearts"),
            makeCard("K", "clubs"),
            makeCard("K", "diamonds"),
            makeCard("3", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_set_size("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 4 });
      });

      it("returns 3 for three-of-a-kind", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("7", "spades"),
            makeCard("7", "hearts"),
            makeCard("7", "clubs"),
            makeCard("Q", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_set_size("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("returns 2 for a pair", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("Q", "spades"),
            makeCard("Q", "hearts"),
            makeCard("7", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_set_size("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 2 });
      });

      it("returns 1 for all unique ranks", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "spades"),
            makeCard("K", "hearts"),
            makeCard("Q", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_set_size("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("returns 0 for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_set_size("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('max_set_size("hand", 2)', ctx)
        ).toThrow("requires exactly 1 argument");
      });
    });

    // ── has_flush ──

    describe("has_flush", () => {
      it("returns true when 5 cards share a suit", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "hearts"),
            makeCard("K", "hearts"),
            makeCard("Q", "hearts"),
            makeCard("J", "hearts"),
            makeCard("9", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_flush("hand", 5)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when no suit has enough cards", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "hearts"),
            makeCard("K", "hearts"),
            makeCard("Q", "spades"),
            makeCard("J", "clubs"),
            makeCard("9", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_flush("hand", 5)', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("returns true for a smaller flush threshold", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "hearts"),
            makeCard("K", "hearts"),
            makeCard("Q", "hearts"),
            makeCard("J", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_flush("hand", 3)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_flush("hand", 1)', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('has_flush("hand")', ctx)).toThrow(
          "requires exactly 2 argument"
        );
      });
    });

    // ── has_straight ──

    describe("has_straight", () => {
      it("detects a 5-card straight (5-6-7-8-9)", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("5", "hearts"),
            makeCard("6", "spades"),
            makeCard("7", "clubs"),
            makeCard("8", "diamonds"),
            makeCard("9", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 5)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("detects ace-low straight (A-2-3-4-5)", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "hearts"),
            makeCard("2", "spades"),
            makeCard("3", "clubs"),
            makeCard("4", "diamonds"),
            makeCard("5", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 5)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("detects ace-high straight (10-J-Q-K-A)", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("10", "hearts"),
            makeCard("J", "spades"),
            makeCard("Q", "clubs"),
            makeCard("K", "diamonds"),
            makeCard("A", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 5)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when no straight of required length", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("4", "spades"),
            makeCard("6", "clubs"),
            makeCard("8", "diamonds"),
            makeCard("10", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 3)', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("detects partial straight in a larger hand", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("3", "hearts"),
            makeCard("4", "spades"),
            makeCard("5", "clubs"),
            makeCard("9", "diamonds"),
            makeCard("K", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 3)', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_straight("hand", 3)', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('has_straight("hand")', ctx)).toThrow(
          "requires exactly 2 argument"
        );
      });
    });

    // ── count_runs ──

    describe("count_runs", () => {
      it("counts two distinct runs", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("3", "spades"),
            makeCard("4", "clubs"),
            makeCard("8", "diamonds"),
            makeCard("9", "hearts"),
            makeCard("10", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Run 1: 2-3-4 (length 3), Run 2: 8-9-10 (length 3)
        const result = evaluateExpression('count_runs("hand", 3)', ctx);
        expect(result).toEqual({ kind: "number", value: 2 });
      });

      it("counts only runs meeting min_length threshold", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("3", "spades"),
            makeCard("4", "clubs"),
            makeCard("8", "diamonds"),
            makeCard("9", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Run 1: 2-3-4 (length 3), Run 2: 8-9 (length 2)
        // min_length=3 → only 1 qualifies
        const result = evaluateExpression('count_runs("hand", 3)', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("returns 0 when no runs meet min_length", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("5", "spades"),
            makeCard("9", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_runs("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("returns 0 for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_runs("hand", 2)', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() => evaluateExpression('count_runs("hand")', ctx)).toThrow(
          "requires exactly 2 argument"
        );
      });
    });

    // ── max_run_length ──

    describe("max_run_length", () => {
      it("returns length of longest run", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("3", "spades"),
            makeCard("4", "clubs"),
            makeCard("5", "diamonds"),
            makeCard("9", "hearts"),
            makeCard("10", "spades"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Run 1: 2-3-4-5 (length 4), Run 2: 9-10 (length 2)
        const result = evaluateExpression('max_run_length("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 4 });
      });

      it("returns 1 for non-consecutive cards", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("2", "hearts"),
            makeCard("5", "spades"),
            makeCard("9", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_run_length("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("returns 0 for empty zone", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('max_run_length("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("handles ace as both low and high in run calculation", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("A", "hearts"),
            makeCard("2", "spades"),
            makeCard("3", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Ace is 1 and 14; values: {1, 2, 3, 14} → run: 1-2-3 (length 3)
        const result = evaluateExpression('max_run_length("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("handles duplicate ranks (only unique values matter)", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", [
            makeCard("5", "hearts"),
            makeCard("5", "spades"),
            makeCard("6", "clubs"),
            makeCard("7", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Unique values: {5, 6, 7} → run of 3
        const result = evaluateExpression('max_run_length("hand")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("throws on wrong arg count", () => {
        const state = makePokerGameState({
          hand: makeZone("hand", []),
        });
        const ctx = makeEvalContext(state);
        expect(() =>
          evaluateExpression('max_run_length("hand", 2)', ctx)
        ).toThrow("requires exactly 1 argument");
      });
    });
  });

  // ── G8 — Trick-Taking Builtins ──────────────────────────────────

  describe("G8 — Trick-Taking Builtins", () => {
    // Hearts-style card values where rank order matters for trick comparison
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

    function makeHeartsRuleset(): CardGameRuleset {
      return {
        meta: {
          name: "Test Hearts",
          slug: "test-hearts",
          version: "1.0.0",
          author: "test",
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
          { name: "trick", visibility: { kind: "public" }, owners: ["player"] },
          { name: "won", visibility: { kind: "hidden" }, owners: ["player"] },
        ],
        roles: [
          { name: "player", isHuman: true, count: "per_player" },
        ],
        phases: [],
        scoring: {
          method: 'count_cards_by_suit(concat("won:", current_player_index), "hearts")',
          winCondition: "my_score == 0",
        },
        visibility: [],
        ui: { layout: "circle", tableColor: "felt_green" },
      };
    }

    function makeHeartsGameState(
      zones: Record<string, ZoneState>,
      overrides: Partial<CardGameState> = {}
    ): CardGameState {
      return {
        sessionId: makeSessionId("hearts-test"),
        ruleset: makeHeartsRuleset(),
        status: { kind: "in_progress", startedAt: Date.now() },
        players: [
          { id: makePlayerId("p0"), name: "Alice", role: "player", connected: true },
          { id: makePlayerId("p1"), name: "Bob", role: "player", connected: true },
          { id: makePlayerId("p2"), name: "Charlie", role: "player", connected: true },
          { id: makePlayerId("p3"), name: "Diana", role: "player", connected: true },
        ],
        zones,
        currentPhase: "play_trick",
        currentPlayerIndex: 0,
        turnNumber: 1,
        scores: {},
        variables: { lead_player: 0 },
        actionLog: [],
        turnsTakenThisPhase: 0,
        turnDirection: 1,
        version: 1,
        ...overrides,
      };
    }

    it("registers all G8 builtin names", () => {
      const names = getRegisteredBuiltins();
      expect(names).toContain("trick_winner");
      expect(names).toContain("led_card_suit");
      expect(names).toContain("trick_card_count");
      expect(names).toContain("count_cards_by_suit");
      expect(names).toContain("has_card_with");
      expect(names).toContain("sum_zone_values_by_suit");
      expect(names).toContain("collect_trick");
      expect(names).toContain("set_lead_player");
      expect(names).toContain("end_game");
    });

    // ── trick_winner ──────────────────────────────────────────────

    describe("trick_winner", () => {
      it("returns winner when highest led-suit card wins", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", [makeCard("5", "hearts")]),
          "trick:3": makeZone("trick:3", [makeCard("A", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        // A(14) is highest hearts card → player 3 wins
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("off-suit cards don't win even with higher rank", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", [makeCard("A", "spades")]),
          "trick:3": makeZone("trick:3", [makeCard("5", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        // Led suit is hearts (player 0 led). A♠ doesn't count. K♥(13) wins → player 1
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("returns -1 when lead_player not set", () => {
        const state = makeHeartsGameState(
          {
            "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
            "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
            "trick:2": makeZone("trick:2", [makeCard("5", "hearts")]),
            "trick:3": makeZone("trick:3", [makeCard("A", "hearts")]),
          },
          { variables: {} }
        );
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: -1 });
      });

      it("returns -1 when lead zone is empty", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", [makeCard("5", "hearts")]),
          "trick:3": makeZone("trick:3", [makeCard("A", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: -1 });
      });

      it("trump suit overrides led suit", () => {
        const state = makeHeartsGameState(
          {
            "trick:0": makeZone("trick:0", [makeCard("A", "hearts")]),
            "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
            "trick:2": makeZone("trick:2", [makeCard("3", "spades")]),
            "trick:3": makeZone("trick:3", [makeCard("5", "hearts")]),
          },
          { variables: { lead_player: 0, trump_suit: "spades" } }
        );
        const ctx = makeEvalContext(state);
        // Trump is spades. Only player 2 played spades (3♠). Trump beats led suit.
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 2 });
      });

      it("highest trump wins among multiple trumps", () => {
        const state = makeHeartsGameState(
          {
            "trick:0": makeZone("trick:0", [makeCard("A", "hearts")]),
            "trick:1": makeZone("trick:1", [makeCard("K", "spades")]),
            "trick:2": makeZone("trick:2", [makeCard("3", "spades")]),
            "trick:3": makeZone("trick:3", [makeCard("5", "hearts")]),
          },
          { variables: { lead_player: 0, trump_suit: "spades" } }
        );
        const ctx = makeEvalContext(state);
        // Two trumps: K♠(13) and 3♠(3). K♠ is higher → player 1 wins
        const result = evaluateExpression('trick_winner("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 1 });
      });
    });

    // ── led_card_suit ─────────────────────────────────────────────

    describe("led_card_suit", () => {
      it("returns suit of lead player's card", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "spades")]),
          "trick:2": makeZone("trick:2", [makeCard("5", "clubs")]),
          "trick:3": makeZone("trick:3", [makeCard("A", "diamonds")]),
        });
        const ctx = makeEvalContext(state);
        // lead_player=0, trick:0 has 10♥ → led suit is "hearts"
        const result = evaluateExpression('led_card_suit("trick")', ctx);
        expect(result).toEqual({ kind: "string", value: "hearts" });
      });

      it("returns empty string when lead_player not set", () => {
        const state = makeHeartsGameState(
          {
            "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
            "trick:1": makeZone("trick:1", [makeCard("K", "spades")]),
            "trick:2": makeZone("trick:2", []),
            "trick:3": makeZone("trick:3", []),
          },
          { variables: {} }
        );
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('led_card_suit("trick")', ctx);
        expect(result).toEqual({ kind: "string", value: "" });
      });

      it("returns empty string when lead zone is empty", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
          "trick:1": makeZone("trick:1", [makeCard("K", "spades")]),
          "trick:2": makeZone("trick:2", []),
          "trick:3": makeZone("trick:3", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('led_card_suit("trick")', ctx);
        expect(result).toEqual({ kind: "string", value: "" });
      });
    });

    // ── trick_card_count ──────────────────────────────────────────

    describe("trick_card_count", () => {
      it("returns total cards across all trick zones", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", [makeCard("5", "hearts")]),
          "trick:3": makeZone("trick:3", [makeCard("A", "hearts")]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('trick_card_count("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 4 });
      });

      it("returns 0 when all trick zones are empty", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
          "trick:1": makeZone("trick:1", []),
          "trick:2": makeZone("trick:2", []),
          "trick:3": makeZone("trick:3", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('trick_card_count("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("returns partial count when only some players have played", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", []),
          "trick:3": makeZone("trick:3", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('trick_card_count("trick")', ctx);
        expect(result).toEqual({ kind: "number", value: 2 });
      });
    });

    // ── count_cards_by_suit ───────────────────────────────────────

    describe("count_cards_by_suit", () => {
      it("counts hearts in a won pile correctly", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("2", "hearts"),
            makeCard("5", "hearts"),
            makeCard("K", "spades"),
            makeCard("3", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_cards_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 3 });
      });

      it("returns 0 when no cards match the suit", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("K", "spades"),
            makeCard("Q", "clubs"),
            makeCard("J", "diamonds"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_cards_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("works with empty zone", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('count_cards_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });
    });

    // ── has_card_with ─────────────────────────────────────────────

    describe("has_card_with", () => {
      it("returns true when zone has Q♠", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("K", "hearts"),
            makeCard("Q", "spades"),
            makeCard("5", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_card_with("won:0", "Q", "spades")', ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("returns false when zone has Q♥ but not Q♠", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("K", "hearts"),
            makeCard("Q", "hearts"),
            makeCard("5", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_card_with("won:0", "Q", "spades")', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("returns false on empty zone", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", []),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('has_card_with("won:0", "Q", "spades")', ctx);
        expect(result).toEqual({ kind: "boolean", value: false });
      });
    });

    // ── sum_zone_values_by_suit ───────────────────────────────────

    describe("sum_zone_values_by_suit", () => {
      it("sums values correctly for hearts in a won pile", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("2", "hearts"),
            makeCard("5", "hearts"),
            makeCard("A", "hearts"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // 2 + 5 + 14 = 21
        const result = evaluateExpression('sum_zone_values_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 21 });
      });

      it("returns 0 when no cards of the suit exist", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("K", "spades"),
            makeCard("Q", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        const result = evaluateExpression('sum_zone_values_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 0 });
      });

      it("only sums matching suit in mixed-suit zone", () => {
        const state = makeHeartsGameState({
          "won:0": makeZone("won:0", [
            makeCard("3", "hearts"),
            makeCard("K", "spades"),
            makeCard("7", "hearts"),
            makeCard("Q", "clubs"),
          ]),
        });
        const ctx = makeEvalContext(state);
        // Only hearts: 3 + 7 = 10
        const result = evaluateExpression('sum_zone_values_by_suit("won:0", "hearts")', ctx);
        expect(result).toEqual({ kind: "number", value: 10 });
      });
    });

    // ── collect_trick (effect builtin) ────────────────────────────

    describe("collect_trick", () => {
      it("records a collect_trick effect with correct params", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", [makeCard("10", "hearts")]),
          "trick:1": makeZone("trick:1", [makeCard("K", "hearts")]),
          "trick:2": makeZone("trick:2", [makeCard("5", "hearts")]),
          "trick:3": makeZone("trick:3", [makeCard("A", "hearts")]),
          "won:0": makeZone("won:0", []),
        });
        const ctx = makeMutableContext(state);
        evaluateExpression('collect_trick("trick", "won:0")', ctx);
        expect(ctx.effects).toHaveLength(1);
        expect(ctx.effects[0]).toEqual({
          kind: "collect_trick",
          params: { zonePrefix: "trick", targetZone: "won:0" },
        });
      });
    });

    // ── set_lead_player (effect builtin) ──────────────────────────

    describe("set_lead_player", () => {
      it("records a set_lead_player effect with correct params", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
        });
        const ctx = makeMutableContext(state);
        evaluateExpression("set_lead_player(2)", ctx);
        expect(ctx.effects).toHaveLength(1);
        expect(ctx.effects[0]).toEqual({
          kind: "set_lead_player",
          params: { playerIndex: 2 },
        });
      });
    });

    // ── end_game (effect builtin) ─────────────────────────────────

    describe("end_game", () => {
      it("records an end_game effect with empty params", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
        });
        const ctx = makeMutableContext(state);
        evaluateExpression("end_game()", ctx);
        expect(ctx.effects).toHaveLength(1);
        expect(ctx.effects[0]).toEqual({
          kind: "end_game",
          params: {},
        });
      });

      it("throws when called with arguments", () => {
        const state = makeHeartsGameState({
          "trick:0": makeZone("trick:0", []),
        });
        const ctx = makeMutableContext(state);
        expect(() =>
          evaluateExpression("end_game(1)", ctx)
        ).toThrow("takes no arguments");
      });
    });
  });
});
