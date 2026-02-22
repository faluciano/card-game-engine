import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PhaseMachine, type TransitionResult } from "./phase-machine.js";
import { registerAllBuiltins, type EffectDescription } from "./builtins.js";
import {
  clearBuiltins,
  evaluateExpression,
  ExpressionError,
  type EvalContext,
} from "./expression-evaluator.js";
import type {
  Card,
  CardInstanceId,
  CardGameState,
  CardGameRuleset,
  CardValue,
  GameSessionId,
  PhaseAction,
  PhaseDefinition,
  PlayerId,
  ZoneDefinition,
  ZoneState,
} from "../types/index.js";

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

function makeMinimalRuleset(
  phases: readonly PhaseDefinition[] = []
): CardGameRuleset {
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
    phases,
    scoring: {
      method: 'sum_card_values(hand, prefer_high_under(21))',
      winCondition: "hand_value <= 21",
      bustCondition: "hand_value > 21",
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
      {
        id: makePlayerId("p1"),
        name: "Alice",
        role: "player",
        connected: true,
      },
      {
        id: makePlayerId("p2"),
        name: "Bob",
        role: "player",
        connected: true,
      },
    ],
    zones,
    currentPhase: "deal",
    currentPlayerIndex: 0,
    turnNumber: 1,
    scores: {},
    actionLog: [],
    version: 1,
    ...overrides,
  };
}

// ─── Blackjack-like Phase Definitions ──────────────────────────────

const DEAL_PHASE: PhaseDefinition = {
  name: "deal",
  kind: "automatic",
  actions: [],
  transitions: [{ to: "player_turns", when: "all_hands_dealt" }],
  automaticSequence: [
    'shuffle("draw_pile")',
    'deal("draw_pile", "hand", 2)',
    'deal("draw_pile", "dealer_hand", 2)',
    'set_face_up("dealer_hand", 0, true)',
  ],
};

const PLAYER_TURNS_PHASE: PhaseDefinition = {
  name: "player_turns",
  kind: "turn_based",
  actions: [
    {
      name: "hit",
      label: "Hit",
      condition: 'hand_value("hand") < 21',
      effect: ['draw("draw_pile", "hand", 1)'],
    },
    {
      name: "stand",
      label: "Stand",
      effect: ["end_turn()"],
    },
  ],
  transitions: [{ to: "scoring", when: "all_players_done" }],
  turnOrder: "clockwise",
};

const SCORING_PHASE: PhaseDefinition = {
  name: "scoring",
  kind: "automatic",
  actions: [],
  transitions: [{ to: "round_end", when: "scores_calculated" }],
  automaticSequence: [
    'reveal_all("dealer_hand")',
    "calculate_scores()",
    "determine_winners()",
  ],
};

const ROUND_END_PHASE: PhaseDefinition = {
  name: "round_end",
  kind: "automatic",
  actions: [],
  transitions: [{ to: "deal", when: "continue_game" }],
  automaticSequence: [
    'collect_all_to("discard")',
    "reset_round()",
  ],
};

const ALL_PHASES = [DEAL_PHASE, PLAYER_TURNS_PHASE, SCORING_PHASE, ROUND_END_PHASE];

// ─── Tests ─────────────────────────────────────────────────────────

describe("PhaseMachine", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  afterEach(() => {
    clearBuiltins();
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("creates a machine from valid phase definitions", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(machine.phaseNames).toEqual([
        "deal",
        "player_turns",
        "scoring",
        "round_end",
      ]);
    });

    it("throws on duplicate phase names", () => {
      const duplicate: PhaseDefinition = { ...DEAL_PHASE };
      expect(() => new PhaseMachine([DEAL_PHASE, duplicate])).toThrow(
        'Duplicate phase name: "deal"'
      );
    });

    it("accepts an empty phase list", () => {
      const machine = new PhaseMachine([]);
      expect(machine.phaseNames).toEqual([]);
    });
  });

  // ── getPhase ──

  describe("getPhase", () => {
    it("returns the phase definition by name", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const phase = machine.getPhase("deal");
      expect(phase.name).toBe("deal");
      expect(phase.kind).toBe("automatic");
    });

    it("throws for an unknown phase name", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(() => machine.getPhase("nonexistent")).toThrow(
        'Unknown phase: "nonexistent"'
      );
    });
  });

  // ── evaluateTransitions ──

  describe("evaluateTransitions", () => {
    it("advances when a sentinel condition is met (bare identifier)", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState({}, { currentPhase: "deal" });

      const result = machine.evaluateTransitions(state);
      expect(result).toEqual({ kind: "advance", nextPhase: "player_turns" });
    });

    it("advances through all blackjack phases with sentinels", () => {
      const machine = new PhaseMachine(ALL_PHASES);

      // deal → player_turns
      let state = makeGameState({}, { currentPhase: "deal" });
      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "player_turns",
      });

      // player_turns → scoring
      state = makeGameState({}, { currentPhase: "player_turns" });
      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "scoring",
      });

      // scoring → round_end
      state = makeGameState({}, { currentPhase: "scoring" });
      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "round_end",
      });

      // round_end → deal
      state = makeGameState({}, { currentPhase: "round_end" });
      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "deal",
      });
    });

    it("returns stay when no transitions match", () => {
      const noTransitionPhase: PhaseDefinition = {
        name: "terminal",
        kind: "automatic",
        actions: [],
        transitions: [],
      };
      const machine = new PhaseMachine([noTransitionPhase]);
      const state = makeGameState({}, { currentPhase: "terminal" });

      expect(machine.evaluateTransitions(state)).toEqual({ kind: "stay" });
    });

    it("returns stay when condition evaluates to false", () => {
      const phaseWithFalseCondition: PhaseDefinition = {
        name: "test_phase",
        kind: "turn_based",
        actions: [],
        transitions: [{ to: "other", when: "false" }],
      };
      const otherPhase: PhaseDefinition = {
        name: "other",
        kind: "automatic",
        actions: [],
        transitions: [],
      };
      const machine = new PhaseMachine([phaseWithFalseCondition, otherPhase]);
      const state = makeGameState({}, { currentPhase: "test_phase" });

      expect(machine.evaluateTransitions(state)).toEqual({ kind: "stay" });
    });

    it("returns the first matching transition when multiple match", () => {
      const phases: PhaseDefinition[] = [
        {
          name: "multi",
          kind: "turn_based",
          actions: [],
          transitions: [
            { to: "first_target", when: "true" },
            { to: "second_target", when: "true" },
          ],
        },
        {
          name: "first_target",
          kind: "automatic",
          actions: [],
          transitions: [],
        },
        {
          name: "second_target",
          kind: "automatic",
          actions: [],
          transitions: [],
        },
      ];
      const machine = new PhaseMachine(phases);
      const state = makeGameState({}, { currentPhase: "multi" });

      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "first_target",
      });
    });

    it("throws when transition targets an unknown phase", () => {
      const badPhase: PhaseDefinition = {
        name: "broken",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "does_not_exist", when: "true" }],
      };
      const machine = new PhaseMachine([badPhase]);
      const state = makeGameState({}, { currentPhase: "broken" });

      expect(() => machine.evaluateTransitions(state)).toThrow(
        'Phase "broken" has a transition to unknown phase: "does_not_exist"'
      );
    });

    it("throws when the current phase is unknown", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState({}, { currentPhase: "nonexistent" });

      expect(() => machine.evaluateTransitions(state)).toThrow(
        'Unknown phase: "nonexistent"'
      );
    });

    it("treats ExpressionError as condition-not-met and logs a warning", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const phaseWithBadCondition: PhaseDefinition = {
        name: "bad_cond",
        kind: "turn_based",
        actions: [],
        transitions: [
          { to: "target", when: "totally_unknown_identifier_xyz" },
        ],
      };
      const target: PhaseDefinition = {
        name: "target",
        kind: "automatic",
        actions: [],
        transitions: [],
      };
      const machine = new PhaseMachine([phaseWithBadCondition, target]);
      const state = makeGameState({}, { currentPhase: "bad_cond" });

      const result = machine.evaluateTransitions(state);
      expect(result).toEqual({ kind: "stay" });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to evaluate")
      );

      warnSpy.mockRestore();
    });

    it("evaluates expression-based conditions against game state", () => {
      const phases: PhaseDefinition[] = [
        {
          name: "check_hand",
          kind: "turn_based",
          actions: [],
          transitions: [
            { to: "bust", when: 'hand_value("hand") > 21' },
            { to: "continue", when: 'hand_value("hand") <= 21' },
          ],
        },
        { name: "bust", kind: "automatic", actions: [], transitions: [] },
        { name: "continue", kind: "automatic", actions: [], transitions: [] },
      ];
      const machine = new PhaseMachine(phases);

      // Player busts
      const bustState = makeGameState(
        {
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("Q", "hearts"),
            makeCard("5", "clubs"),
          ]),
        },
        { currentPhase: "check_hand" }
      );
      expect(machine.evaluateTransitions(bustState)).toEqual({
        kind: "advance",
        nextPhase: "bust",
      });

      // Player doesn't bust
      const safeState = makeGameState(
        {
          hand: makeZone("hand", [
            makeCard("K", "spades"),
            makeCard("5", "hearts"),
          ]),
        },
        { currentPhase: "check_hand" }
      );
      expect(machine.evaluateTransitions(safeState)).toEqual({
        kind: "advance",
        nextPhase: "continue",
      });
    });

    it("skips false conditions and matches a later one", () => {
      const phases: PhaseDefinition[] = [
        {
          name: "start",
          kind: "turn_based",
          actions: [],
          transitions: [
            { to: "nope", when: "false" },
            { to: "yes", when: "true" },
          ],
        },
        { name: "nope", kind: "automatic", actions: [], transitions: [] },
        { name: "yes", kind: "automatic", actions: [], transitions: [] },
      ];
      const machine = new PhaseMachine(phases);
      const state = makeGameState({}, { currentPhase: "start" });

      expect(machine.evaluateTransitions(state)).toEqual({
        kind: "advance",
        nextPhase: "yes",
      });
    });
  });

  // ── Sentinel Identifier Fallback (expression-evaluator change) ──

  describe("sentinel identifier fallback", () => {
    it("resolves bare sentinel identifiers as zero-arg builtin calls", () => {
      // This tests the expression-evaluator change directly:
      // `all_hands_dealt` (no parens) should resolve to true via the builtin
      const state = makeGameState({});
      const ctx: EvalContext = { state };
      const result = evaluateExpression("all_hands_dealt", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("resolves all four blackjack sentinels as bare identifiers", () => {
      const state = makeGameState({});
      const ctx: EvalContext = { state };

      for (const sentinel of [
        "all_hands_dealt",
        "all_players_done",
        "scores_calculated",
        "continue_game",
      ]) {
        const result = evaluateExpression(sentinel, ctx);
        expect(result).toEqual({ kind: "boolean", value: true });
      }
    });

    it("still throws for truly unknown identifiers", () => {
      const state = makeGameState({});
      const ctx: EvalContext = { state };
      expect(() => evaluateExpression("completely_unknown_xyz", ctx)).toThrow(
        ExpressionError
      );
    });

    it("sentinel with parens still works as function call", () => {
      const state = makeGameState({});
      const ctx: EvalContext = { state };
      const result = evaluateExpression("all_hands_dealt()", ctx);
      expect(result).toEqual({ kind: "boolean", value: true });
    });
  });

  // ── executeAutomaticPhase ──

  describe("executeAutomaticPhase", () => {
    it("executes the deal phase automatic sequence and returns effects", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState(
        {
          draw_pile: makeZone("draw_pile", []),
          hand: makeZone("hand", []),
          dealer_hand: makeZone("dealer_hand", []),
        },
        { currentPhase: "deal" }
      );

      const effects = machine.executeAutomaticPhase(state);

      expect(effects).toEqual([
        { kind: "shuffle", params: { zone: "draw_pile" } },
        { kind: "deal", params: { from: "draw_pile", to: "hand", count: 2 } },
        {
          kind: "deal",
          params: { from: "draw_pile", to: "dealer_hand", count: 2 },
        },
        {
          kind: "set_face_up",
          params: { zone: "dealer_hand", cardIndex: 0, faceUp: true },
        },
      ]);
    });

    it("executes the scoring phase automatic sequence", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState(
        {
          dealer_hand: makeZone("dealer_hand", []),
        },
        { currentPhase: "scoring" }
      );

      const effects = machine.executeAutomaticPhase(state);

      expect(effects).toEqual([
        { kind: "reveal_all", params: { zone: "dealer_hand" } },
        { kind: "calculate_scores", params: {} },
        { kind: "determine_winners", params: {} },
      ]);
    });

    it("executes the round_end phase automatic sequence", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState({}, { currentPhase: "round_end" });

      const effects = machine.executeAutomaticPhase(state);

      expect(effects).toEqual([
        { kind: "collect_all_to", params: { zone: "discard" } },
        { kind: "reset_round", params: {} },
      ]);
    });

    it("returns empty array when automaticSequence is empty", () => {
      const emptyAutoPhase: PhaseDefinition = {
        name: "empty_auto",
        kind: "automatic",
        actions: [],
        transitions: [],
        automaticSequence: [],
      };
      const machine = new PhaseMachine([emptyAutoPhase]);
      const state = makeGameState({}, { currentPhase: "empty_auto" });

      expect(machine.executeAutomaticPhase(state)).toEqual([]);
    });

    it("returns empty array when automaticSequence is undefined", () => {
      const noSeqPhase: PhaseDefinition = {
        name: "no_seq",
        kind: "automatic",
        actions: [],
        transitions: [],
      };
      const machine = new PhaseMachine([noSeqPhase]);
      const state = makeGameState({}, { currentPhase: "no_seq" });

      expect(machine.executeAutomaticPhase(state)).toEqual([]);
    });

    it("throws when called on a non-automatic phase", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState({}, { currentPhase: "player_turns" });

      expect(() => machine.executeAutomaticPhase(state)).toThrow(
        'Cannot execute automatic sequence on "player_turns": phase kind is "turn_based", expected "automatic"'
      );
    });

    it("throws for unknown current phase", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const state = makeGameState({}, { currentPhase: "nonexistent" });

      expect(() => machine.executeAutomaticPhase(state)).toThrow(
        'Unknown phase: "nonexistent"'
      );
    });

    it("effects accumulate across multiple sequence expressions", () => {
      const multiEffectPhase: PhaseDefinition = {
        name: "multi",
        kind: "automatic",
        actions: [],
        transitions: [],
        automaticSequence: [
          'shuffle("draw_pile")',
          'shuffle("draw_pile")',
          'shuffle("draw_pile")',
        ],
      };
      const machine = new PhaseMachine([multiEffectPhase]);
      const state = makeGameState(
        { draw_pile: makeZone("draw_pile", []) },
        { currentPhase: "multi" }
      );

      const effects = machine.executeAutomaticPhase(state);
      expect(effects).toHaveLength(3);
      expect(effects.every((e) => e.kind === "shuffle")).toBe(true);
    });
  });

  // ── getValidActionsForPhase ──

  describe("getValidActionsForPhase", () => {
    it("returns actions for a turn-based phase", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const actions = machine.getValidActionsForPhase("player_turns");

      expect(actions).toHaveLength(2);
      expect(actions[0]!.name).toBe("hit");
      expect(actions[0]!.label).toBe("Hit");
      expect(actions[0]!.condition).toBe('hand_value("hand") < 21');
      expect(actions[1]!.name).toBe("stand");
      expect(actions[1]!.label).toBe("Stand");
    });

    it("returns empty array for a phase with no actions", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const actions = machine.getValidActionsForPhase("deal");
      expect(actions).toEqual([]);
    });

    it("throws for unknown phase name", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(() => machine.getValidActionsForPhase("nonexistent")).toThrow(
        'Unknown phase: "nonexistent"'
      );
    });

    it("returns a readonly array", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      const actions = machine.getValidActionsForPhase("player_turns");
      // TypeScript readonly enforcement — just verify it's an array
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  // ── isAutomaticPhase ──

  describe("isAutomaticPhase", () => {
    it("returns true for automatic phases", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(machine.isAutomaticPhase("deal")).toBe(true);
      expect(machine.isAutomaticPhase("scoring")).toBe(true);
      expect(machine.isAutomaticPhase("round_end")).toBe(true);
    });

    it("returns false for non-automatic phases", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(machine.isAutomaticPhase("player_turns")).toBe(false);
    });

    it("throws for unknown phase name", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(() => machine.isAutomaticPhase("nonexistent")).toThrow(
        'Unknown phase: "nonexistent"'
      );
    });

    it("distinguishes all_players kind from automatic", () => {
      const allPlayersPhase: PhaseDefinition = {
        name: "reveal",
        kind: "all_players",
        actions: [],
        transitions: [],
      };
      const machine = new PhaseMachine([allPlayersPhase]);
      expect(machine.isAutomaticPhase("reveal")).toBe(false);
    });
  });

  // ── phaseNames ──

  describe("phaseNames", () => {
    it("preserves definition order", () => {
      const machine = new PhaseMachine(ALL_PHASES);
      expect(machine.phaseNames).toEqual([
        "deal",
        "player_turns",
        "scoring",
        "round_end",
      ]);
    });

    it("returns empty for no phases", () => {
      const machine = new PhaseMachine([]);
      expect(machine.phaseNames).toEqual([]);
    });
  });

  // ── Integration: Full Blackjack Cycle ──

  describe("integration: full blackjack phase cycle", () => {
    it("deal → execute → transition → player_turns → transition → scoring → execute → transition → round_end → execute → transition → deal", () => {
      const machine = new PhaseMachine(ALL_PHASES);

      // 1. Start at deal phase (automatic)
      expect(machine.isAutomaticPhase("deal")).toBe(true);

      const dealState = makeGameState(
        {
          draw_pile: makeZone("draw_pile", []),
          hand: makeZone("hand", []),
          dealer_hand: makeZone("dealer_hand", []),
        },
        { currentPhase: "deal" }
      );

      // Execute the automatic sequence
      const dealEffects = machine.executeAutomaticPhase(dealState);
      expect(dealEffects.length).toBeGreaterThan(0);

      // Evaluate transition: deal → player_turns
      const afterDeal = machine.evaluateTransitions(dealState);
      expect(afterDeal).toEqual({ kind: "advance", nextPhase: "player_turns" });

      // 2. Player turns (turn-based, not automatic)
      expect(machine.isAutomaticPhase("player_turns")).toBe(false);
      const actions = machine.getValidActionsForPhase("player_turns");
      expect(actions.length).toBe(2);

      // After all players done, transition to scoring
      const ptState = makeGameState({}, { currentPhase: "player_turns" });
      const afterPT = machine.evaluateTransitions(ptState);
      expect(afterPT).toEqual({ kind: "advance", nextPhase: "scoring" });

      // 3. Scoring (automatic)
      expect(machine.isAutomaticPhase("scoring")).toBe(true);
      const scoringState = makeGameState(
        { dealer_hand: makeZone("dealer_hand", []) },
        { currentPhase: "scoring" }
      );
      const scoringEffects = machine.executeAutomaticPhase(scoringState);
      expect(scoringEffects.length).toBe(3);

      const afterScoring = machine.evaluateTransitions(scoringState);
      expect(afterScoring).toEqual({ kind: "advance", nextPhase: "round_end" });

      // 4. Round end (automatic)
      expect(machine.isAutomaticPhase("round_end")).toBe(true);
      const reState = makeGameState({}, { currentPhase: "round_end" });
      const reEffects = machine.executeAutomaticPhase(reState);
      expect(reEffects.length).toBe(2);

      const afterRE = machine.evaluateTransitions(reState);
      expect(afterRE).toEqual({ kind: "advance", nextPhase: "deal" });
    });
  });
});
