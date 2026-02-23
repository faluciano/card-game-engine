import { describe, it, expect, beforeEach } from "vitest";
import {
  getValidActions,
  validateAction,
  executePhaseAction,
  type ValidAction,
  type ActionValidationResult,
} from "./action-validator";
import { PhaseMachine } from "./phase-machine";
import { registerAllBuiltins } from "./builtins";
import { clearBuiltins } from "./expression-evaluator";
import type {
  Card,
  CardInstanceId,
  CardGameAction,
  CardGameState,
  CardGameRuleset,
  CardValue,
  GameSessionId,
  PhaseAction,
  PhaseDefinition,
  PlayerId,
  ZoneDefinition,
  ZoneState,
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

// ─── Phase Definitions ─────────────────────────────────────────────

const DEAL_PHASE: PhaseDefinition = {
  name: "deal",
  kind: "automatic",
  actions: [],
  transitions: [{ to: "player_turns", when: "all_hands_dealt" }],
  automaticSequence: [
    'shuffle("draw_pile")',
    'deal("draw_pile", "hand", 2)',
    'deal("draw_pile", "dealer_hand", 2)',
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

const ALL_PLAYERS_PHASE: PhaseDefinition = {
  name: "betting",
  kind: "all_players",
  actions: [
    {
      name: "place_bet",
      label: "Place Bet",
      effect: [],
    },
  ],
  transitions: [{ to: "deal", when: "all_players_done" }],
};

const SCORING_PHASE: PhaseDefinition = {
  name: "scoring",
  kind: "automatic",
  actions: [],
  transitions: [{ to: "deal", when: "scores_calculated" }],
  automaticSequence: [
    "calculate_scores()",
    "determine_winners()",
  ],
};

const ALL_PHASES = [DEAL_PHASE, PLAYER_TURNS_PHASE, ALL_PLAYERS_PHASE, SCORING_PHASE];

function makeMinimalRuleset(
  phases: readonly PhaseDefinition[] = ALL_PHASES
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

function makeDefaultZones(): Record<string, ZoneState> {
  return {
    draw_pile: makeZone("draw_pile", [
      makeCard("5", "hearts"),
      makeCard("6", "spades"),
      makeCard("7", "diamonds"),
    ]),
    hand: makeZone("hand", [
      makeCard("10", "hearts"),
      makeCard("5", "spades"),
    ]),
    dealer_hand: makeZone("dealer_hand", [
      makeCard("K", "clubs"),
      makeCard("8", "hearts"),
    ]),
    discard: makeZone("discard", []),
  };
}

function makeBustedZones(): Record<string, ZoneState> {
  return {
    draw_pile: makeZone("draw_pile", [makeCard("3", "hearts")]),
    hand: makeZone("hand", [
      makeCard("10", "hearts"),
      makeCard("J", "spades"),
      makeCard("5", "diamonds"),
    ]),
    dealer_hand: makeZone("dealer_hand", [
      makeCard("K", "clubs"),
      makeCard("8", "hearts"),
    ]),
    discard: makeZone("discard", []),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Action Validator", () => {
  let machine: PhaseMachine;

  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
    machine = new PhaseMachine(ALL_PHASES);
  });

  // ── getValidActions ──────────────────────────────────────────────

  describe("getValidActions", () => {
    it("returns empty array when game is not in progress", () => {
      const state = makeGameState(makeDefaultZones(), {
        status: { kind: "waiting_for_players" },
      });

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toEqual([]);
    });

    it("returns empty array when game is finished", () => {
      const state = makeGameState(makeDefaultZones(), {
        status: { kind: "finished", finishedAt: Date.now(), winnerId: null },
      });

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toEqual([]);
    });

    it("returns empty array during automatic phase", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPhase: "deal",
      });

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toEqual([]);
    });

    it("returns empty array for unknown player", () => {
      const state = makeGameState(makeDefaultZones());

      const actions = getValidActions(state, makePlayerId("unknown"), machine);
      expect(actions).toEqual([]);
    });

    it("returns empty array for non-current player in turn_based phase", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPlayerIndex: 0,
      });

      // p2 is index 1, but currentPlayerIndex is 0
      const actions = getValidActions(state, makePlayerId("p2"), machine);
      expect(actions).toEqual([]);
    });

    it("returns all phase actions for the current player", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPlayerIndex: 0,
      });

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toHaveLength(2);
      expect(actions[0]).toEqual({
        actionName: "hit",
        label: "Hit",
        enabled: true,
      });
      expect(actions[1]).toEqual({
        actionName: "stand",
        label: "Stand",
        enabled: true,
      });
    });

    it("marks action disabled when condition evaluates to false", () => {
      // hand_value("hand") >= 21, so "hit" condition (< 21) is false
      const state = makeGameState(makeBustedZones());

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      const hitAction = actions.find((a) => a.actionName === "hit");
      const standAction = actions.find((a) => a.actionName === "stand");

      expect(hitAction).toBeDefined();
      expect(hitAction!.enabled).toBe(false);
      expect(standAction).toBeDefined();
      expect(standAction!.enabled).toBe(true);
    });

    it("returns actions for all players in all_players phase", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPhase: "betting",
        currentPlayerIndex: 0,
      });

      // Both p1 (current) and p2 (not current) should get actions
      const p1Actions = getValidActions(state, makePlayerId("p1"), machine);
      const p2Actions = getValidActions(state, makePlayerId("p2"), machine);

      expect(p1Actions).toHaveLength(1);
      expect(p1Actions[0]!.actionName).toBe("place_bet");
      expect(p2Actions).toHaveLength(1);
      expect(p2Actions[0]!.actionName).toBe("place_bet");
    });

    it("works without explicit phaseMachine parameter (constructs from state)", () => {
      const state = makeGameState(makeDefaultZones());

      // No phaseMachine argument — should auto-construct from state.ruleset
      const actions = getValidActions(state, makePlayerId("p1"));
      expect(actions).toHaveLength(2);
      expect(actions[0]!.actionName).toBe("hit");
      expect(actions[1]!.actionName).toBe("stand");
    });

    it("includes both enabled and disabled actions", () => {
      const state = makeGameState(makeBustedZones());

      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toHaveLength(2);

      const enabled = actions.filter((a) => a.enabled);
      const disabled = actions.filter((a) => !a.enabled);
      expect(enabled).toHaveLength(1);
      expect(disabled).toHaveLength(1);
    });

    it("disables action when condition throws ExpressionError", () => {
      const brokenPhase: PhaseDefinition = {
        name: "broken",
        kind: "turn_based",
        actions: [
          {
            name: "broken_action",
            label: "Broken",
            condition: "nonexistent_func()",
            effect: [],
          },
        ],
        transitions: [],
        turnOrder: "clockwise",
      };

      const brokenMachine = new PhaseMachine([brokenPhase]);
      const state = makeGameState(makeDefaultZones(), {
        currentPhase: "broken",
        ruleset: makeMinimalRuleset([brokenPhase]),
      });

      const actions = getValidActions(state, makePlayerId("p1"), brokenMachine);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.enabled).toBe(false);
    });

    it("returns empty array for actions in second player's turn when it's first player's turn", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPlayerIndex: 1,
      });

      // p1 is index 0, but current is index 1
      const actions = getValidActions(state, makePlayerId("p1"), machine);
      expect(actions).toEqual([]);

      // p2 is index 1 = currentPlayerIndex
      const p2Actions = getValidActions(state, makePlayerId("p2"), machine);
      expect(p2Actions).toHaveLength(2);
    });
  });

  // ── validateAction ───────────────────────────────────────────────

  describe("validateAction", () => {
    describe("game status guards", () => {
      it("rejects actions when game is not in progress", () => {
        const state = makeGameState(makeDefaultZones(), {
          status: { kind: "waiting_for_players" },
        });

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Game is not in progress");
        }
      });

      it("allows start_game when waiting for players", () => {
        const state = makeGameState(makeDefaultZones(), {
          status: { kind: "waiting_for_players" },
        });

        const result = validateAction(
          state,
          { kind: "start_game" },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("rejects start_game when game is finished", () => {
        const state = makeGameState(makeDefaultZones(), {
          status: { kind: "finished", finishedAt: Date.now(), winnerId: null },
        });

        const result = validateAction(
          state,
          { kind: "start_game" },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Game is not waiting for players");
        }
      });

      it("rejects start_game when game is already in progress", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "start_game" },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Game is already in progress");
        }
      });

      it("allows join when game is not in progress", () => {
        const state = makeGameState(makeDefaultZones(), {
          status: { kind: "waiting_for_players" },
        });

        const result = validateAction(
          state,
          { kind: "join", playerId: makePlayerId("p3"), name: "Charlie" },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("allows leave when game is not in progress", () => {
        const state = makeGameState(makeDefaultZones(), {
          status: { kind: "waiting_for_players" },
        });

        const result = validateAction(
          state,
          { kind: "leave", playerId: makePlayerId("p1") },
          machine
        );

        expect(result.valid).toBe(true);
      });
    });

    describe("declare actions", () => {
      it("validates a valid declare action", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("validates stand action (no condition)", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "stand",
          },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("rejects declare during automatic phase", () => {
        const state = makeGameState(makeDefaultZones(), {
          currentPhase: "deal",
        });

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Cannot act during automatic phase");
        }
      });

      it("rejects declare from unknown player", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("unknown"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Player not found");
        }
      });

      it("rejects declare when it's not the player's turn", () => {
        const state = makeGameState(makeDefaultZones(), {
          currentPlayerIndex: 0,
        });

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p2"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("It is not your turn");
        }
      });

      it("rejects unknown declaration in current phase", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "split",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe(
            "Action 'split' not available in phase 'player_turns'"
          );
        }
      });

      it("rejects declare when condition is not met", () => {
        // Busted hand: value >= 21, so hit condition (< 21) is false
        const state = makeGameState(makeBustedZones());

        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p1"),
            declaration: "hit",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("Action condition not met");
        }
      });

      it("allows declare in all_players phase regardless of turn", () => {
        const state = makeGameState(makeDefaultZones(), {
          currentPhase: "betting",
          currentPlayerIndex: 0,
        });

        // p2 (not current player) can act in all_players phase
        const result = validateAction(
          state,
          {
            kind: "declare",
            playerId: makePlayerId("p2"),
            declaration: "place_bet",
          },
          machine
        );

        expect(result.valid).toBe(true);
      });
    });

    describe("join and leave actions", () => {
      it("allows join during in_progress", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "join", playerId: makePlayerId("p3"), name: "Charlie" },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("allows leave during in_progress", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "leave", playerId: makePlayerId("p1") },
          machine
        );

        expect(result.valid).toBe(true);
      });
    });

    describe("internal engine actions", () => {
      it("allows advance_phase during in_progress", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "advance_phase" },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("allows reset_round during in_progress", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "reset_round" },
          machine
        );

        expect(result.valid).toBe(true);
      });
    });

    describe("play_card action", () => {
      it("validates a valid play_card action", () => {
        const zones = makeDefaultZones();
        const cardId = zones.hand.cards[0]!.id;
        const state = makeGameState(zones);

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("p1"),
            cardId,
            fromZone: "hand",
            toZone: "discard",
          },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("rejects play_card from unknown player", () => {
        const zones = makeDefaultZones();
        const cardId = zones.hand.cards[0]!.id;
        const state = makeGameState(zones);

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("unknown"),
            cardId,
            fromZone: "hand",
            toZone: "discard",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Player not found");
        }
      });

      it("rejects play_card when not player's turn (turn_based)", () => {
        const zones = makeDefaultZones();
        const cardId = zones.hand.cards[0]!.id;
        const state = makeGameState(zones, { currentPlayerIndex: 0 });

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("p2"),
            cardId,
            fromZone: "hand",
            toZone: "discard",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("It is not your turn");
        }
      });

      it("rejects play_card when card not in fromZone", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("p1"),
            cardId: makeCardId("nonexistent"),
            fromZone: "hand",
            toZone: "discard",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("not found in zone");
        }
      });

      it("rejects play_card when fromZone does not exist", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("p1"),
            cardId: makeCardId("any"),
            fromZone: "nonexistent_zone",
            toZone: "discard",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("Zone 'nonexistent_zone' not found");
        }
      });

      it("rejects play_card when toZone does not exist", () => {
        const zones = makeDefaultZones();
        const cardId = zones.hand.cards[0]!.id;
        const state = makeGameState(zones);

        const result = validateAction(
          state,
          {
            kind: "play_card",
            playerId: makePlayerId("p1"),
            cardId,
            fromZone: "hand",
            toZone: "nonexistent_zone",
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("Zone 'nonexistent_zone' not found");
        }
      });
    });

    describe("draw_card action", () => {
      it("validates a valid draw_card action", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p1"),
            fromZone: "draw_pile",
            toZone: "hand",
            count: 1,
          },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("rejects draw_card when fromZone does not have enough cards", () => {
        const zones = makeDefaultZones();
        const state = makeGameState(zones);

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p1"),
            fromZone: "draw_pile",
            toZone: "hand",
            count: 100,
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("card(s), need 100");
        }
      });

      it("rejects draw_card from nonexistent zone", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p1"),
            fromZone: "nonexistent",
            toZone: "hand",
            count: 1,
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("Zone 'nonexistent' not found");
        }
      });

      it("rejects draw_card to nonexistent zone", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p1"),
            fromZone: "draw_pile",
            toZone: "nonexistent",
            count: 1,
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("Zone 'nonexistent' not found");
        }
      });

      it("rejects draw_card when not player's turn", () => {
        const state = makeGameState(makeDefaultZones(), {
          currentPlayerIndex: 0,
        });

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p2"),
            fromZone: "draw_pile",
            toZone: "hand",
            count: 1,
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("It is not your turn");
        }
      });

      it("rejects draw_card from empty zone", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          {
            kind: "draw_card",
            playerId: makePlayerId("p1"),
            fromZone: "discard",
            toZone: "hand",
            count: 1,
          },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain("has 0 card(s), need 1");
        }
      });
    });

    describe("end_turn action", () => {
      it("validates end_turn for current player", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "end_turn", playerId: makePlayerId("p1") },
          machine
        );

        expect(result.valid).toBe(true);
      });

      it("rejects end_turn for non-current player", () => {
        const state = makeGameState(makeDefaultZones(), {
          currentPlayerIndex: 0,
        });

        const result = validateAction(
          state,
          { kind: "end_turn", playerId: makePlayerId("p2") },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("It is not your turn");
        }
      });

      it("rejects end_turn for unknown player", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(
          state,
          { kind: "end_turn", playerId: makePlayerId("unknown") },
          machine
        );

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toBe("Player not found");
        }
      });
    });

    describe("optional phaseMachine parameter", () => {
      it("works without explicit phaseMachine (constructs from state)", () => {
        const state = makeGameState(makeDefaultZones());

        const result = validateAction(state, {
          kind: "declare",
          playerId: makePlayerId("p1"),
          declaration: "hit",
        });

        expect(result.valid).toBe(true);
      });
    });
  });

  // ── executePhaseAction ───────────────────────────────────────────

  describe("executePhaseAction", () => {
    it("executes hit action and returns draw effect", () => {
      const state = makeGameState(makeDefaultZones());

      const effects = executePhaseAction(state, "hit", 0, machine);

      expect(effects).toHaveLength(1);
      expect(effects[0]).toEqual({
        kind: "draw",
        params: { from: "draw_pile", to: "hand", count: 1 },
      });
    });

    it("executes stand action and returns end_turn effect", () => {
      const state = makeGameState(makeDefaultZones());

      const effects = executePhaseAction(state, "stand", 0, machine);

      expect(effects).toHaveLength(1);
      expect(effects[0]).toEqual({
        kind: "end_turn",
        params: {},
      });
    });

    it("throws when action not found in phase", () => {
      const state = makeGameState(makeDefaultZones());

      expect(() => {
        executePhaseAction(state, "nonexistent", 0, machine);
      }).toThrow("Action 'nonexistent' not found in phase 'player_turns'");
    });

    it("passes playerIndex to the evaluation context", () => {
      const state = makeGameState(makeDefaultZones());

      // Both player indices should work
      const effects0 = executePhaseAction(state, "hit", 0, machine);
      const effects1 = executePhaseAction(state, "hit", 1, machine);

      expect(effects0).toHaveLength(1);
      expect(effects1).toHaveLength(1);
    });

    it("throws when phase not found", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPhase: "nonexistent_phase",
      });

      expect(() => {
        executePhaseAction(state, "hit", 0, machine);
      }).toThrow('Unknown phase: "nonexistent_phase"');
    });

    it("returns empty array for action with no effects", () => {
      const state = makeGameState(makeDefaultZones(), {
        currentPhase: "betting",
      });

      const effects = executePhaseAction(state, "place_bet", 0, machine);
      expect(effects).toEqual([]);
    });
  });
});
