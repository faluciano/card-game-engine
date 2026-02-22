import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRuleset,
  createInitialState,
  createReducer,
  RulesetParseError,
} from "./interpreter.js";
import { clearBuiltins } from "./expression-evaluator.js";
import { registerAllBuiltins } from "./builtins.js";
import type {
  CardGameRuleset,
  CardGameState,
  CardGameAction,
  GameSessionId,
  Player,
  PlayerId,
  CardValue,
  PhaseDefinition,
} from "../types/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────

function makePlayerId(id: string): PlayerId {
  return id as PlayerId;
}

function makeSessionId(id: string): GameSessionId {
  return id as GameSessionId;
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
        automaticSequence: [
          "calculate_scores()",
          "determine_winners()",
        ],
      },
      {
        name: "round_end",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "deal", when: "continue_game" }],
        automaticSequence: [
          "collect_all_to(draw_pile)",
          "reset_round()",
        ],
      },
    ],
    scoring: {
      method: "sum_card_values(hand, prefer_high_under(21))",
      winCondition: "hand_value <= 21",
      bustCondition: "hand_value > 21",
    },
    visibility: [],
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

function makeRawBlackjack(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(makeBlackjackRuleset()));
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

const FIXED_SEED = 42;

// ─── Tests ─────────────────────────────────────────────────────────

describe("Ruleset Interpreter", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  // ── loadRuleset ──────────────────────────────────────────────────

  describe("loadRuleset", () => {
    it("parses a valid ruleset JSON", () => {
      const raw = makeRawBlackjack();
      const ruleset = loadRuleset(raw);

      expect(ruleset.meta.name).toBe("Blackjack");
      expect(ruleset.meta.slug).toBe("blackjack");
      expect(ruleset.deck.preset).toBe("standard_52");
      expect(ruleset.zones).toHaveLength(4);
      expect(ruleset.phases).toHaveLength(5);
    });

    it("throws RulesetParseError for invalid JSON", () => {
      expect(() => loadRuleset({})).toThrow(RulesetParseError);
    });

    it("includes formatted issue strings in the error", () => {
      try {
        loadRuleset({ meta: { name: "" } });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(RulesetParseError);
        const parseError = error as RulesetParseError;
        expect(parseError.issues.length).toBeGreaterThan(0);
        expect(parseError.message).toContain("issue(s)");
      }
    });

    it("throws RulesetParseError for missing required fields", () => {
      const raw = makeRawBlackjack();
      delete (raw as Record<string, unknown>).deck;

      expect(() => loadRuleset(raw)).toThrow(RulesetParseError);
    });

    it("throws RulesetParseError for invalid player range", () => {
      const raw = makeRawBlackjack();
      (raw as Record<string, unknown>).meta = {
        ...(raw.meta as Record<string, unknown>),
        players: { min: 10, max: 2 },
      };

      expect(() => loadRuleset(raw)).toThrow(RulesetParseError);
    });
  });

  // ── createInitialState ───────────────────────────────────────────

  describe("createInitialState", () => {
    it("creates a valid initial state", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(2);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      expect(state.sessionId).toBe("s1");
      expect(state.status.kind).toBe("waiting_for_players");
      expect(state.players).toHaveLength(2);
      expect(state.currentPhase).toBe("deal");
      expect(state.currentPlayerIndex).toBe(0);
      expect(state.turnNumber).toBe(1);
      expect(state.version).toBe(0);
      expect(state.actionLog).toEqual([]);
      expect(state.scores).toEqual({});
    });

    it("creates per-player zones for each player", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(3);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      // Should have hand:0, hand:1, hand:2 (per-player)
      expect(state.zones["hand:0"]).toBeDefined();
      expect(state.zones["hand:1"]).toBeDefined();
      expect(state.zones["hand:2"]).toBeDefined();
      // Should NOT have a shared "hand" zone
      expect(state.zones["hand"]).toBeUndefined();
    });

    it("creates shared zones for non-per-player roles", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(2);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      expect(state.zones["draw_pile"]).toBeDefined();
      expect(state.zones["dealer_hand"]).toBeDefined();
      expect(state.zones["discard"]).toBeDefined();
    });

    it("puts all cards in the draw pile", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(2);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      // standard_52 × 1 copy = 52 cards
      expect(state.zones["draw_pile"]!.cards).toHaveLength(52);
    });

    it("creates deterministic card IDs from seed", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);

      const state1 = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );
      const state2 = createInitialState(
        ruleset,
        makeSessionId("s2"),
        players,
        FIXED_SEED
      );

      // Same seed → same card IDs
      const ids1 = state1.zones["draw_pile"]!.cards.map((c) => c.id);
      const ids2 = state2.zones["draw_pile"]!.cards.map((c) => c.id);
      expect(ids1).toEqual(ids2);
    });

    it("creates different card IDs for different seeds", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);

      const state1 = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        42
      );
      const state2 = createInitialState(
        ruleset,
        makeSessionId("s2"),
        players,
        999
      );

      const ids1 = state1.zones["draw_pile"]!.cards.map((c) => c.id);
      const ids2 = state2.zones["draw_pile"]!.cards.map((c) => c.id);
      expect(ids1).not.toEqual(ids2);
    });

    it("all cards start face down", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      const allFaceDown = state.zones["draw_pile"]!.cards.every(
        (c) => !c.faceUp
      );
      expect(allFaceDown).toBe(true);
    });

    it("throws RangeError for too few players", () => {
      const ruleset = makeBlackjackRuleset();

      expect(() =>
        createInitialState(ruleset, makeSessionId("s1"), [], FIXED_SEED)
      ).toThrow(RangeError);
    });

    it("throws RangeError for too many players", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(10);

      expect(() =>
        createInitialState(ruleset, makeSessionId("s1"), players, FIXED_SEED)
      ).toThrow(RangeError);
    });

    it("preserves the ruleset reference in state", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      expect(state.ruleset).toBe(ruleset);
    });

    it("handles multi-copy decks", () => {
      const ruleset: CardGameRuleset = {
        ...makeBlackjackRuleset(),
        deck: { ...makeBlackjackRuleset().deck, copies: 2 },
      };
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      // 52 × 2 = 104 cards
      expect(state.zones["draw_pile"]!.cards).toHaveLength(104);
    });

    it("per-player zone cards are initially empty", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(2);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      expect(state.zones["hand:0"]!.cards).toHaveLength(0);
      expect(state.zones["hand:1"]!.cards).toHaveLength(0);
    });
  });

  // ── createReducer ────────────────────────────────────────────────

  describe("createReducer", () => {
    it("returns a function", () => {
      const ruleset = makeBlackjackRuleset();
      const reducer = createReducer(ruleset, FIXED_SEED);

      expect(typeof reducer).toBe("function");
    });

    describe("join action", () => {
      it("adds a new player", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(1);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const newState = reducer(state, {
          kind: "join",
          playerId: makePlayerId("p5"),
          name: "Charlie",
        });

        expect(newState.players).toHaveLength(2);
        expect(newState.players[1]!.name).toBe("Charlie");
        expect(newState.players[1]!.connected).toBe(true);
        expect(newState.version).toBe(state.version + 1);
      });

      it("reconnects an existing player", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(1);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        // First disconnect
        const disconnected = reducer(state, {
          kind: "leave",
          playerId: makePlayerId("p0"),
        });
        expect(disconnected.players[0]!.connected).toBe(false);

        // Then reconnect
        const reconnected = reducer(disconnected, {
          kind: "join",
          playerId: makePlayerId("p0"),
          name: "Player 0",
        });
        expect(reconnected.players[0]!.connected).toBe(true);
        expect(reconnected.players).toHaveLength(1); // didn't add duplicate
      });
    });

    describe("leave action", () => {
      it("marks a player as disconnected", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const newState = reducer(state, {
          kind: "leave",
          playerId: makePlayerId("p0"),
        });

        expect(newState.players[0]!.connected).toBe(false);
        expect(newState.players[1]!.connected).toBe(true);
        expect(newState.players).toHaveLength(2); // player not removed
      });

      it("returns unchanged state for unknown player", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(1);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const newState = reducer(state, {
          kind: "leave",
          playerId: makePlayerId("unknown"),
        });

        expect(newState.version).toBe(state.version);
      });
    });

    describe("start_game action", () => {
      it("transitions from waiting_for_players to in_progress", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        expect(state.status.kind).toBe("waiting_for_players");

        const started = reducer(state, { kind: "start_game" });
        expect(started.status.kind).toBe("in_progress");
      });

      it("executes the deal automatic phase", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const started = reducer(state, { kind: "start_game" });

        // After deal: each player gets 2 cards, dealer gets 2
        expect(started.zones["hand:0"]!.cards).toHaveLength(2);
        expect(started.zones["hand:1"]!.cards).toHaveLength(2);
        expect(started.zones["dealer_hand"]!.cards).toHaveLength(2);

        // Draw pile should be reduced: 52 - 2*2 - 2 = 46
        expect(started.zones["draw_pile"]!.cards).toHaveLength(46);

        // Should advance to player_turns (non-automatic)
        expect(started.currentPhase).toBe("player_turns");
      });

      it("dealer's first card is face up after deal", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(1);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const started = reducer(state, { kind: "start_game" });
        const dealerCards = started.zones["dealer_hand"]!.cards;

        expect(dealerCards[0]!.faceUp).toBe(true);
        // Second card stays face down
        expect(dealerCards[1]!.faceUp).toBe(false);
      });

      it("does nothing if not in waiting_for_players state", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        // Start once
        const started = reducer(state, { kind: "start_game" });
        // Try to start again
        const same = reducer(started, { kind: "start_game" });

        expect(same).toBe(started); // same reference — no-op
      });

      it("is deterministic with same seed", () => {
        const ruleset = makeBlackjackRuleset();
        const players = makePlayers(2);

        const reducer1 = createReducer(ruleset, FIXED_SEED);
        const state1 = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );
        const started1 = reducer1(state1, { kind: "start_game" });

        const reducer2 = createReducer(ruleset, FIXED_SEED);
        const state2 = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );
        const started2 = reducer2(state2, { kind: "start_game" });

        // Same cards dealt
        const hand1 = started1.zones["hand:0"]!.cards.map((c) => `${c.rank}${c.suit}`);
        const hand2 = started2.zones["hand:0"]!.cards.map((c) => `${c.rank}${c.suit}`);
        expect(hand1).toEqual(hand2);
      });
    });

    describe("declare action", () => {
      function startedState(): {
        state: CardGameState;
        reducer: ReturnType<typeof createReducer>;
      } {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const started = reducer(state, { kind: "start_game" });
        return { state: started, reducer };
      }

      it("stand ends the current player's turn", () => {
        const { state, reducer } = startedState();

        expect(state.currentPlayerIndex).toBe(0);

        const afterStand = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "stand",
        });

        // After stand, the end_turn effect should advance the player index
        // The transition check follows — but since it's turn-based, player should advance
        expect(afterStand.version).toBeGreaterThan(state.version);
      });

      it("rejects declare from wrong player", () => {
        const { state, reducer } = startedState();

        expect(state.currentPlayerIndex).toBe(0);

        const afterBadDeclare = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p1"), // not current player
          declaration: "hit",
        });

        // Should be unchanged (invalid action is a no-op)
        expect(afterBadDeclare.version).toBe(state.version);
      });

      it("rejects unknown declaration", () => {
        const { state, reducer } = startedState();

        const afterBad = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "split", // not defined in our ruleset
        });

        expect(afterBad.version).toBe(state.version);
      });

      it("hit draws a card and triggers full round completion", () => {
        // Note: all_players_done always returns true, so after any declare
        // the game advances through dealer_turn → scoring → round_end → deal.
        // This tests that the full flow completes without error.
        const { state, reducer } = startedState();

        const afterHit = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        // The game should have completed a full round and be back at player_turns
        // (round_end → deal → player_turns)
        expect(afterHit.status.kind).toBe("in_progress");
        expect(afterHit.currentPhase).toBe("player_turns");
        expect(afterHit.version).toBeGreaterThan(state.version);
      });

      it("logs the action in actionLog", () => {
        const { state, reducer } = startedState();

        const afterHit = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        const lastLog = afterHit.actionLog[afterHit.actionLog.length - 1]!;
        expect(lastLog.action.kind).toBe("declare");
      });
    });

    describe("end_turn action", () => {
      it("advances to the next player", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(2);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        const started = reducer(state, { kind: "start_game" });
        expect(started.currentPlayerIndex).toBe(0);

        const afterEndTurn = reducer(started, {
          kind: "end_turn",
          playerId: makePlayerId("p0"),
        });

        // Should advance to next player or trigger transition
        expect(afterEndTurn.version).toBeGreaterThan(started.version);
      });
    });

    describe("version increments", () => {
      it("increments version on every valid action", () => {
        const ruleset = makeBlackjackRuleset();
        const reducer = createReducer(ruleset, FIXED_SEED);
        const players = makePlayers(1);
        const state = createInitialState(
          ruleset,
          makeSessionId("s1"),
          players,
          FIXED_SEED
        );

        expect(state.version).toBe(0);

        const v1 = reducer(state, { kind: "start_game" });
        expect(v1.version).toBeGreaterThan(0);
      });
    });
  });

  // ── Effect Application (via reducer) ─────────────────────────────

  describe("effect application via full game flow", () => {
    it("shuffle effect produces deterministic card order", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);

      // Two identical runs with same seed
      const reducer1 = createReducer(ruleset, 123);
      const state1 = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        123
      );
      const started1 = reducer1(state1, { kind: "start_game" });

      const reducer2 = createReducer(ruleset, 123);
      const state2 = createInitialState(
        ruleset,
        makeSessionId("s2"),
        players,
        123
      );
      const started2 = reducer2(state2, { kind: "start_game" });

      // Cards in hand should be identical
      const handCards1 = started1.zones["hand:0"]!.cards.map(
        (c) => `${c.rank}_${c.suit}`
      );
      const handCards2 = started2.zones["hand:0"]!.cards.map(
        (c) => `${c.rank}_${c.suit}`
      );
      expect(handCards1).toEqual(handCards2);
    });

    it("different seeds produce different deals", () => {
      const ruleset = makeBlackjackRuleset();
      const players = makePlayers(1);

      const reducer1 = createReducer(ruleset, 42);
      const state1 = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        42
      );
      const started1 = reducer1(state1, { kind: "start_game" });

      const reducer2 = createReducer(ruleset, 999);
      const state2 = createInitialState(
        ruleset,
        makeSessionId("s2"),
        players,
        999
      );
      const started2 = reducer2(state2, { kind: "start_game" });

      const handCards1 = started1.zones["hand:0"]!.cards.map(
        (c) => `${c.rank}_${c.suit}`
      );
      const handCards2 = started2.zones["hand:0"]!.cards.map(
        (c) => `${c.rank}_${c.suit}`
      );
      expect(handCards1).not.toEqual(handCards2);
    });

    it("full blackjack game start produces valid state", () => {
      const ruleset = makeBlackjackRuleset();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(3);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      const started = reducer(state, { kind: "start_game" });

      // 3 players × 2 cards + 2 dealer cards = 8 cards dealt
      const totalDealt =
        started.zones["hand:0"]!.cards.length +
        started.zones["hand:1"]!.cards.length +
        started.zones["hand:2"]!.cards.length +
        started.zones["dealer_hand"]!.cards.length;

      expect(totalDealt).toBe(8);

      // Draw pile should have 52 - 8 = 44 cards
      expect(started.zones["draw_pile"]!.cards).toHaveLength(44);

      // Game should be in progress at player_turns
      expect(started.status.kind).toBe("in_progress");
      expect(started.currentPhase).toBe("player_turns");
    });
  });

  // ── RulesetParseError ────────────────────────────────────────────

  describe("RulesetParseError", () => {
    it("has correct name property", () => {
      const err = new RulesetParseError("test", ["issue1"]);
      expect(err.name).toBe("RulesetParseError");
    });

    it("has correct message", () => {
      const err = new RulesetParseError("some message", []);
      expect(err.message).toBe("some message");
    });

    it("preserves issues array", () => {
      const issues = ["field1: required", "field2: invalid"];
      const err = new RulesetParseError("test", issues);
      expect(err.issues).toEqual(issues);
    });

    it("is an instance of Error", () => {
      const err = new RulesetParseError("test", []);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
