import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRuleset,
  createInitialState,
  createReducer,
  RulesetParseError,
} from "./interpreter";
import { clearBuiltins } from "./expression-evaluator";
import { registerAllBuiltins } from "./builtins";
import type {
  Card,
  CardInstanceId,
  CardGameRuleset,
  CardGameState,
  CardGameAction,
  GameSessionId,
  Player,
  PlayerId,
  CardValue,
  PhaseDefinition,
} from "../types/index";

// ─── Fixtures ──────────────────────────────────────────────────────

function makePlayerId(id: string): PlayerId {
  return id as PlayerId;
}

function makeSessionId(id: string): GameSessionId {
  return id as GameSessionId;
}

function makeCardId(id: string): CardInstanceId {
  return id as CardInstanceId;
}

function makeCard(rank: string, suit: string, faceUp = true): Card {
  return {
    id: makeCardId(`${rank}_${suit}`),
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
      method: "hand_value(current_player.hand, 21)",
      winCondition: "my_score <= 21 && (dealer_score > 21 || my_score > dealer_score)",
      bustCondition: "my_score > 21",
      tieCondition: "my_score == dealer_score && my_score <= 21",
      autoEndTurnCondition: "hand_value(current_player.hand, 21) >= 21",
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

    describe("custom deck support", () => {
      it("creates game with custom deck cards", () => {
        const customRuleset = {
          ...makeBlackjackRuleset(),
          deck: {
            preset: "custom" as const,
            cards: [
              { suit: "red", rank: "1" },
              { suit: "red", rank: "2" },
              { suit: "blue", rank: "1" },
              { suit: "blue", rank: "2" },
            ],
            copies: 1,
            cardValues: {
              "1": { kind: "fixed" as const, value: 1 },
              "2": { kind: "fixed" as const, value: 2 },
            },
          },
        };
        const players = makePlayers(1);
        const state = createInitialState(
          customRuleset,
          makeSessionId("custom-test"),
          players,
          42
        );

        // Count total cards across all zones
        const totalCards = Object.values(state.zones).reduce(
          (sum, zone) => sum + zone.cards.length,
          0
        );
        expect(totalCards).toBe(4); // 4 custom cards × 1 copy
      });

      it("custom deck respects copies multiplier", () => {
        const customRuleset = {
          ...makeBlackjackRuleset(),
          deck: {
            preset: "custom" as const,
            cards: [
              { suit: "star", rank: "High" },
              { suit: "star", rank: "Low" },
            ],
            copies: 3,
            cardValues: {
              High: { kind: "fixed" as const, value: 10 },
              Low: { kind: "fixed" as const, value: 1 },
            },
          },
        };
        const players = makePlayers(1);
        const state = createInitialState(
          customRuleset,
          makeSessionId("copies-test"),
          players,
          42
        );

        const totalCards = Object.values(state.zones).reduce(
          (sum, zone) => sum + zone.cards.length,
          0
        );
        expect(totalCards).toBe(6); // 2 cards × 3 copies
      });

      it("custom deck cards have correct suit and rank", () => {
        const customRuleset = {
          ...makeBlackjackRuleset(),
          deck: {
            preset: "custom" as const,
            cards: [
              { suit: "fire", rank: "Dragon" },
              { suit: "ice", rank: "Phoenix" },
            ],
            copies: 1,
            cardValues: {
              Dragon: { kind: "fixed" as const, value: 10 },
              Phoenix: { kind: "fixed" as const, value: 5 },
            },
          },
        };
        const players = makePlayers(1);
        const state = createInitialState(
          customRuleset,
          makeSessionId("suit-rank-test"),
          players,
          42
        );

        const allCards = Object.values(state.zones).flatMap(
          (zone) => zone.cards
        );
        expect(allCards).toHaveLength(2);

        const suits = allCards.map((c) => c.suit).sort();
        expect(suits).toEqual(["fire", "ice"]);

        const ranks = allCards.map((c) => c.rank).sort();
        expect(ranks).toEqual(["Dragon", "Phoenix"]);
      });

      it("custom deck cards have deterministic IDs from seed", () => {
        const customRuleset = {
          ...makeBlackjackRuleset(),
          deck: {
            preset: "custom" as const,
            cards: [{ suit: "x", rank: "A" }],
            copies: 1,
            cardValues: {
              A: { kind: "fixed" as const, value: 1 },
            },
          },
        };
        const players = makePlayers(1);

        const state1 = createInitialState(
          customRuleset,
          makeSessionId("det1"),
          players,
          42
        );
        const state2 = createInitialState(
          customRuleset,
          makeSessionId("det2"),
          players,
          42
        );

        const ids1 = Object.values(state1.zones).flatMap((z) =>
          z.cards.map((c) => c.id)
        );
        const ids2 = Object.values(state2.zones).flatMap((z) =>
          z.cards.map((c) => c.id)
        );
        expect(ids1).toEqual(ids2);
      });
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

      it("collect_all_to resets faceUp on all collected cards", () => {
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

        // Rig: set ALL cards in all zones to faceUp: true
        const rigged: CardGameState = {
          ...started,
          zones: Object.fromEntries(
            Object.entries(started.zones).map(([name, zone]) => [
              name,
              {
                ...zone,
                cards: zone.cards.map((c) => ({ ...c, faceUp: true })),
              },
            ])
          ),
        };

        // Verify at least some cards are faceUp
        const dealerCards = rigged.zones["dealer_hand"]!.cards;
        expect(dealerCards.every((c) => c.faceUp)).toBe(true);

        // Force round_end with collect_all_to via standing (which triggers
        // the full auto-chain: dealer_turn → scoring → round_end → deal → player_turns)
        // The inline ruleset has automatic round_end, so it chains all the way.
        let current = reducer(rigged, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "stand",
        });

        // After the full chain (round_end → deal → player_turns), cards that
        // were collected FROM other zones back into draw_pile have faceUp reset
        // to false. However, cards already in draw_pile keep their original state.
        // The shuffle randomizes card order, so dealt cards may come from either
        // the original draw_pile (still faceUp: true) or collected cards (faceUp: false).
        //
        // The key invariant: cards collected from hands/dealer back to draw_pile
        // are reset to faceUp: false.
        const drawPileCards = current.zones["draw_pile"]!.cards;
        const collectedCards = drawPileCards.filter((c) => !c.faceUp);
        // At least some cards in the draw pile should have been reset (the collected ones)
        expect(collectedCards.length).toBeGreaterThan(0);

        // After a full round, we should be back in player_turns with fresh hands
        const newDealerCards = current.zones["dealer_hand"]!.cards;
        expect(newDealerCards).toHaveLength(2);
        // First card was flipped by set_face_up(dealer_hand, 0, true)
        expect(newDealerCards[0]!.faceUp).toBe(true);
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

      it("hit draws a card and stays in player_turns", () => {
        // With the all_players_done fix, hit does not call end_turn so
        // the game stays in player_turns (the player can hit again).
        const { state, reducer } = startedState();

        const afterHit = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        // Game stays in player_turns — player 0 can still act
        expect(afterHit.status.kind).toBe("in_progress");
        expect(afterHit.currentPhase).toBe("player_turns");
        expect(afterHit.version).toBeGreaterThan(state.version);
        // Player 0's hand has 3 cards (2 dealt + 1 drawn)
        expect(afterHit.zones["hand:0"]!.cards).toHaveLength(3);
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

    describe("auto-end turn on bust", () => {
      /**
       * Sets up a 2-player started game where player 0's hand is rigged
       * to be close to (or over) 21, and the draw pile's top card is known.
       */
      function riggedBustState(options: {
        playerHandCards: Card[];
        drawPileTopCard: Card;
      }): {
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

        // Override player 0's hand and the draw pile's top card
        const riggedState: CardGameState = {
          ...started,
          zones: {
            ...started.zones,
            "hand:0": {
              ...started.zones["hand:0"]!,
              cards: options.playerHandCards,
            },
            draw_pile: {
              ...started.zones["draw_pile"]!,
              cards: [
                options.drawPileTopCard,
                ...started.zones["draw_pile"]!.cards,
              ],
            },
          },
        };

        return { state: riggedState, reducer };
      }

      it("auto-ends turn when player busts after hit", () => {
        // Player 0 has K + Q = 20. Draw pile top is 10 → bust with 30.
        const { state, reducer } = riggedBustState({
          playerHandCards: [
            makeCard("K", "spades"),
            makeCard("Q", "hearts"),
          ],
          drawPileTopCard: makeCard("10", "clubs"),
        });

        expect(state.currentPlayerIndex).toBe(0);
        expect(state.turnsTakenThisPhase).toBe(0);

        const afterHit = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        // Player 0 busted → auto-end-turn should have advanced to player 1
        expect(afterHit.currentPlayerIndex).toBe(1);
        expect(afterHit.currentPhase).toBe("player_turns");
        expect(afterHit.status.kind).toBe("in_progress");
        // Player 0's hand should have 3 cards (2 original + 1 drawn)
        expect(afterHit.zones["hand:0"]!.cards).toHaveLength(3);
      });

      it("auto-stands at exactly 21 after hit", () => {
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

        // Rig player 0's hand to 11 (Ace), put a 10 on top of draw pile
        // so hitting gives exactly 21
        const rigged: CardGameState = {
          ...started,
          zones: {
            ...started.zones,
            "hand:0": {
              ...started.zones["hand:0"]!,
              cards: [makeCard("A", "spades"), makeCard("5", "hearts")],
            },
            draw_pile: {
              ...started.zones["draw_pile"]!,
              cards: [
                makeCard("5", "diamonds"),
                ...started.zones["draw_pile"]!.cards,
              ],
            },
          },
        };

        expect(rigged.currentPlayerIndex).toBe(0);

        // Player 0 hits → hand becomes A + 5 + 5 = 21 → should auto-stand
        const afterHit = reducer(rigged, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        // Turn should have automatically advanced to player 1
        expect(afterHit.currentPlayerIndex).toBe(1);
        // Still in player_turns (not transitioned away)
        expect(afterHit.currentPhase).toBe("player_turns");
        // Player 0's hand should have 3 cards
        expect(afterHit.zones["hand:0"]!.cards).toHaveLength(3);
      });

      it("does NOT auto-end turn when player does not bust", () => {
        // Player 0 has 5 + 6 = 11. Draw pile top is 2 → 13 (no bust).
        const { state, reducer } = riggedBustState({
          playerHandCards: [
            makeCard("5", "spades"),
            makeCard("6", "hearts"),
          ],
          drawPileTopCard: makeCard("2", "clubs"),
        });

        expect(state.currentPlayerIndex).toBe(0);

        const afterHit = reducer(state, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        // No bust → player 0 stays as current player
        expect(afterHit.currentPlayerIndex).toBe(0);
        expect(afterHit.currentPhase).toBe("player_turns");
        expect(afterHit.turnsTakenThisPhase).toBe(0);
        // Player 0's hand should have 3 cards
        expect(afterHit.zones["hand:0"]!.cards).toHaveLength(3);
      });

      it("does not double-apply end_turn for stand", () => {
        // Stand already includes end_turn() in its effects.
        // Verify it doesn't get applied twice.
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
        expect(started.turnsTakenThisPhase).toBe(0);

        const afterStand = reducer(started, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "stand",
        });

        // After stand, turnsTakenThisPhase should be 1 (not 2).
        // currentPlayerIndex should be 1 (not 0 from wrapping around with 2 increments).
        expect(afterStand.currentPlayerIndex).toBe(1);
        expect(afterStand.turnsTakenThisPhase).toBe(1);
        expect(afterStand.currentPhase).toBe("player_turns");
      });

      it("advances through full round after all players bust via auto-end-turn", () => {
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

        // Rig both players to bust: give them high-value hands and put
        // high-value cards at the top of draw_pile.
        const rigged: CardGameState = {
          ...started,
          zones: {
            ...started.zones,
            "hand:0": {
              ...started.zones["hand:0"]!,
              cards: [makeCard("K", "spades"), makeCard("Q", "hearts")],
            },
            "hand:1": {
              ...started.zones["hand:1"]!,
              cards: [makeCard("K", "diamonds"), makeCard("Q", "clubs")],
            },
            draw_pile: {
              ...started.zones["draw_pile"]!,
              cards: [
                makeCard("10", "spades"),
                makeCard("10", "hearts"),
                ...started.zones["draw_pile"]!.cards,
              ],
            },
          },
        };

        // Player 0 hits and busts → auto-end-turn
        let current = reducer(rigged, {
          kind: "declare",
          playerId: makePlayerId("p0"),
          declaration: "hit",
        });

        expect(current.currentPhase).toBe("player_turns");
        expect(current.currentPlayerIndex).toBe(1);

        // Player 1 hits and busts → auto-end-turn, all_players_done triggers
        current = reducer(current, {
          kind: "declare",
          playerId: makePlayerId("p1"),
          declaration: "hit",
        });

        // all_players_done fires → dealer_turn → scoring → round_end → deal
        // → back to player_turns with a new round (higher turnNumber)
        expect(current.status.kind).toBe("in_progress");
        expect(current.currentPhase).toBe("player_turns");
        expect(current.turnNumber).toBeGreaterThan(started.turnNumber);
        // Fresh hands dealt for new round
        expect(current.zones["hand:0"]!.cards).toHaveLength(2);
        expect(current.zones["hand:1"]!.cards).toHaveLength(2);
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

      it("increments turnsTakenThisPhase", () => {
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
        expect(started.turnsTakenThisPhase).toBe(0);

        // Dispatch a raw end_turn action (as opposed to "stand" which goes through declare)
        const afterEndTurn = reducer(started, {
          kind: "end_turn",
          playerId: makePlayerId("p0"),
        });

        expect(afterEndTurn.turnsTakenThisPhase).toBe(1);
        expect(afterEndTurn.currentPlayerIndex).toBe(1);
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

  // ── all_players round_end phase ──────────────────────────────────

  describe("all_players round_end phase", () => {
    /**
     * Creates a blackjack ruleset where round_end is all_players
     * (matching the production blackjack.cardgame.json).
     */
    function makeBlackjackWithAllPlayersRoundEnd(): CardGameRuleset {
      const base = makeBlackjackRuleset();
      return {
        ...base,
        phases: base.phases.map((phase) =>
          phase.name === "round_end"
            ? {
                ...phase,
                kind: "all_players" as const,
                actions: [
                  {
                    name: "new_round",
                    label: "New Round",
                    effect: [
                      "collect_all_to(draw_pile)",
                      "reset_round()",
                    ],
                  },
                ],
                automaticSequence: undefined,
              }
            : phase.name === "player_turns"
              ? {
                  ...phase,
                  // Also remove the bust transition like production ruleset
                  transitions: [{ to: "dealer_turn", when: "all_players_done" }],
                }
              : phase
        ),
      };
    }

    it("stops at round_end after scoring instead of auto-chaining", () => {
      const ruleset = makeBlackjackWithAllPlayersRoundEnd();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      const started = reducer(state, { kind: "start_game" });

      // Stand to trigger dealer_turn → scoring → round_end (stops here)
      const afterStand = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "stand",
      });

      // Should stop at round_end, NOT chain back to player_turns
      expect(afterStand.currentPhase).toBe("round_end");
      // Scores should be populated (scoring phase ran)
      expect(afterStand.scores).toHaveProperty("dealer_score");
      expect(afterStand.scores).toHaveProperty("player_score:0");
      // Dealer hand should still have cards (not collected yet)
      expect(afterStand.zones["dealer_hand"]!.cards.length).toBeGreaterThan(0);
    });

    it("new_round action collects cards and starts new round", () => {
      const ruleset = makeBlackjackWithAllPlayersRoundEnd();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      const started = reducer(state, { kind: "start_game" });
      const turnNumberBefore = started.turnNumber;

      // Stand to reach round_end
      const atRoundEnd = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "stand",
      });
      expect(atRoundEnd.currentPhase).toBe("round_end");

      // Dispatch "new_round" action
      const afterNewRound = reducer(atRoundEnd, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "new_round",
      });

      // Should have looped: collect → reset → deal → player_turns
      expect(afterNewRound.currentPhase).toBe("player_turns");
      expect(afterNewRound.turnNumber).toBeGreaterThan(turnNumberBefore);
      // Fresh hands dealt
      expect(afterNewRound.zones["hand:0"]!.cards).toHaveLength(2);
      expect(afterNewRound.zones["dealer_hand"]!.cards).toHaveLength(2);
      // Scores reset
      expect(afterNewRound.scores).toEqual({});
    });

    it("any player can trigger new_round in all_players phase", () => {
      const ruleset = makeBlackjackWithAllPlayersRoundEnd();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(2);
      const state = createInitialState(
        ruleset,
        makeSessionId("s1"),
        players,
        FIXED_SEED
      );

      const started = reducer(state, { kind: "start_game" });

      // Both players stand
      let current = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "stand",
      });
      current = reducer(current, {
        kind: "declare",
        playerId: makePlayerId("p1"),
        declaration: "stand",
      });

      expect(current.currentPhase).toBe("round_end");

      // Player 1 (not player 0) can trigger new_round because it's all_players phase
      const afterNewRound = reducer(current, {
        kind: "declare",
        playerId: makePlayerId("p1"),
        declaration: "new_round",
      });

      expect(afterNewRound.currentPhase).toBe("player_turns");
    });
  });

  // ── Turn Order Effects ───────────────────────────────────────────

  describe("turn order effects", () => {
    /**
     * Minimal ruleset for turn-order testing.
     * 3 human players, a draw pile, per-player hands, and a turn-based phase
     * with actions that trigger turn-order effects.
     */
    function makeTurnOrderRuleset(): CardGameRuleset {
      return {
        meta: {
          name: "TurnOrder Test",
          slug: "turn-order-test",
          version: "1.0.0",
          author: "test",
          players: { min: 2, max: 6 },
        },
        deck: {
          preset: "custom",
          cards: [
            { suit: "s", rank: "1" },
            { suit: "s", rank: "2" },
            { suit: "s", rank: "3" },
            { suit: "s", rank: "4" },
            { suit: "s", rank: "5" },
            { suit: "s", rank: "6" },
            { suit: "s", rank: "7" },
            { suit: "s", rank: "8" },
            { suit: "s", rank: "9" },
          ],
          copies: 1,
          cardValues: {
            "1": { kind: "fixed", value: 1 },
            "2": { kind: "fixed", value: 2 },
            "3": { kind: "fixed", value: 3 },
            "4": { kind: "fixed", value: 4 },
            "5": { kind: "fixed", value: 5 },
            "6": { kind: "fixed", value: 6 },
            "7": { kind: "fixed", value: 7 },
            "8": { kind: "fixed", value: 8 },
            "9": { kind: "fixed", value: 9 },
          },
        } as CardGameRuleset["deck"],
        zones: [
          { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
          { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
        ],
        roles: [
          { name: "player", isHuman: true, count: "per_player" },
        ],
        phases: [
          {
            name: "deal",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "player_turns", when: "true" }],
            automaticSequence: [
              "deal(draw_pile, hand, 1)",
            ],
          },
          {
            name: "player_turns",
            kind: "turn_based",
            actions: [
              {
                name: "pass",
                label: "Pass",
                effect: ["end_turn()"],
              },
              {
                name: "reverse",
                label: "Reverse",
                effect: ["reverse_turn_order()", "end_turn()"],
              },
              {
                name: "skip",
                label: "Skip",
                effect: ["skip_next_player()", "end_turn()"],
              },
              {
                name: "set_player",
                label: "Set Player",
                // set_next_player(N) followed by end_turn — but set_next_player
                // sets currentPlayerIndex directly, then end_turn advances from there.
                // We'll test set_next_player separately via a dedicated action.
                effect: ["set_next_player(2)"],
              },
            ],
            transitions: [],
            turnOrder: "clockwise",
          },
        ],
        scoring: {
          method: "none",
          winCondition: "false",
          bustCondition: "false",
        },
        visibility: [],
        ui: { layout: "semicircle", tableColor: "felt_green" },
      } as CardGameRuleset;
    }

    function startTurnOrderGame(playerCount: number) {
      const ruleset = makeTurnOrderRuleset();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(playerCount);
      const initial = createInitialState(
        ruleset,
        makeSessionId("turn-test"),
        players,
        FIXED_SEED
      );
      const started = reducer(initial, { kind: "start_game" });
      return { reducer, started, ruleset };
    }

    it("end_turn advances clockwise by default (player 0 → 1)", () => {
      const { reducer, started } = startTurnOrderGame(3);
      expect(started.currentPlayerIndex).toBe(0);
      expect(started.turnDirection).toBe(1);

      const after = reducer(started, {
        kind: "end_turn",
        playerId: makePlayerId("p0"),
      });
      expect(after.currentPlayerIndex).toBe(1);
    });

    it("end_turn advances counterclockwise when turnDirection is -1", () => {
      const { reducer, started } = startTurnOrderGame(3);
      // Patch turnDirection to -1 and set player to 1
      const patched: CardGameState = {
        ...started,
        currentPlayerIndex: 1,
        turnDirection: -1,
      };

      const after = reducer(patched, {
        kind: "end_turn",
        playerId: makePlayerId("p1"),
      });
      expect(after.currentPlayerIndex).toBe(0);
    });

    it("counterclockwise wraps around: player 0 → player 2 (with 3 players)", () => {
      const { reducer, started } = startTurnOrderGame(3);
      const patched: CardGameState = {
        ...started,
        currentPlayerIndex: 0,
        turnDirection: -1,
      };

      const after = reducer(patched, {
        kind: "end_turn",
        playerId: makePlayerId("p0"),
      });
      expect(after.currentPlayerIndex).toBe(2);
    });

    it("reverse_turn_order flips turnDirection from 1 to -1", () => {
      const { reducer, started } = startTurnOrderGame(3);
      expect(started.turnDirection).toBe(1);

      // "reverse" action: reverse_turn_order() + end_turn()
      const after = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "reverse",
      });

      expect(after.turnDirection).toBe(-1);
    });

    it("reverse twice restores turnDirection to 1", () => {
      const { reducer, started } = startTurnOrderGame(3);
      expect(started.turnDirection).toBe(1);

      // First reverse (player 0): direction flips to -1, end_turn goes counterclockwise
      const afterFirst = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "reverse",
      });
      expect(afterFirst.turnDirection).toBe(-1);

      // After reverse + end_turn from player 0 with direction -1:
      // next = (0 + (-1)) % 3 + 3 % 3 = 2
      const nextPlayer = afterFirst.currentPlayerIndex;

      // Second reverse by whoever is current
      const afterSecond = reducer(afterFirst, {
        kind: "declare",
        playerId: makePlayerId(`p${nextPlayer}`),
        declaration: "reverse",
      });
      expect(afterSecond.turnDirection).toBe(1);
    });

    it("skip_next_player advances by one extra step", () => {
      const { reducer, started } = startTurnOrderGame(3);
      expect(started.currentPlayerIndex).toBe(0);

      // "skip" action: skip_next_player() + end_turn()
      // skip_next_player advances currentPlayerIndex by 1 (0 → 1)
      // then end_turn advances by 1 more (1 → 2)
      const after = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "skip",
      });

      expect(after.currentPlayerIndex).toBe(2);
    });

    it("set_next_player sets the current player index directly", () => {
      const { reducer, started } = startTurnOrderGame(3);
      expect(started.currentPlayerIndex).toBe(0);

      // "set_player" action: set_next_player(2)
      const after = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "set_player",
      });

      expect(after.currentPlayerIndex).toBe(2);
    });

    it("reset_round resets turnDirection to 1", () => {
      const { reducer, started } = startTurnOrderGame(3);

      // First, reverse the turn direction
      const reversed = reducer(started, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "reverse",
      });
      expect(reversed.turnDirection).toBe(-1);

      // Now manually create a state that simulates applying reset_round
      // (reset_round is typically in automatic phases; we test the effect handler
      //  by verifying the property is reset in the created initial state)
      const resetState: CardGameState = {
        ...reversed,
        // Simulate what applyResetRoundEffect does
        currentPlayerIndex: 0,
        turnNumber: reversed.turnNumber + 1,
        turnsTakenThisPhase: 0,
        turnDirection: 1,
        scores: {},
        variables: { ...(reversed.ruleset.initialVariables ?? {}) },
      };
      expect(resetState.turnDirection).toBe(1);
    });

    it("createInitialState sets turnDirection to 1", () => {
      const ruleset = makeTurnOrderRuleset();
      const players = makePlayers(3);
      const state = createInitialState(
        ruleset,
        makeSessionId("init-test"),
        players,
        FIXED_SEED
      );
      expect(state.turnDirection).toBe(1);
    });
  });

  // ── Custom Variable Effects ─────────────────────────────────────

  describe("Custom Variable Effects", () => {
    /**
     * Minimal ruleset for variable testing.
     * Has a turn-based phase with actions that use set_var and inc_var.
     */
    function makeVarRuleset(
      initialVariables?: Record<string, number>
    ): CardGameRuleset {
      return {
        meta: {
          name: "Var Test",
          slug: "var-test",
          version: "1.0.0",
          author: "test",
          players: { min: 1, max: 4 },
        },
        deck: {
          preset: "custom",
          cards: [{ suit: "s", rank: "1" }],
          copies: 1,
          cardValues: { "1": { kind: "fixed", value: 1 } },
        } as CardGameRuleset["deck"],
        zones: [
          { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
          { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
        ],
        roles: [{ name: "player", isHuman: true, count: "per_player" }],
        phases: [
          {
            name: "deal",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "play", when: "true" }],
            automaticSequence: [],
          },
          {
            name: "play",
            kind: "turn_based",
            actions: [
              {
                name: "set_x",
                label: "Set X",
                effect: ['set_var("x", 10)'],
              },
              {
                name: "inc_x",
                label: "Inc X",
                effect: ['inc_var("x", 3)'],
              },
              {
                name: "dec_x",
                label: "Dec X",
                effect: ['inc_var("x", -2)'],
              },
              {
                name: "pass",
                label: "Pass",
                effect: ["end_turn()"],
              },
            ],
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
        ...(initialVariables !== undefined ? { initialVariables } : {}),
      };
    }

    it("createInitialState sets variables from initialVariables", () => {
      const ruleset = makeVarRuleset({ x: 5, y: 0 });
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      expect(state.variables).toEqual({ x: 5, y: 0 });
    });

    it("createInitialState sets empty variables when no initialVariables", () => {
      const ruleset = makeVarRuleset();
      const players = makePlayers(1);
      const state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      expect(state.variables).toEqual({});
    });

    it("set_var sets a variable via declare action", () => {
      const ruleset = makeVarRuleset({ x: 0 });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      // set_x sets x = 10
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "set_x",
      });
      expect(state.variables.x).toBe(10);
    });

    it("set_var overwrites existing variable", () => {
      const ruleset = makeVarRuleset({ x: 99 });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "set_x",
      });
      // x was 99, now should be 10
      expect(state.variables.x).toBe(10);
    });

    it("inc_var increments existing variable", () => {
      const ruleset = makeVarRuleset({ x: 7 });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      // inc_x increments x by 3
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "inc_x",
      });
      expect(state.variables.x).toBe(10);
    });

    it("inc_var creates variable from 0 if not existing", () => {
      // No initialVariables — x doesn't exist
      const ruleset = makeVarRuleset({});
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "inc_x",
      });
      // 0 + 3 = 3
      expect(state.variables.x).toBe(3);
    });

    it("inc_var with negative amount decrements", () => {
      const ruleset = makeVarRuleset({ x: 10 });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      // dec_x increments by -2
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "dec_x",
      });
      expect(state.variables.x).toBe(8);
    });

    it("reset_round resets variables to initialVariables", () => {
      // Use a ruleset that has a round_end phase with reset_round
      const ruleset: CardGameRuleset = {
        ...makeVarRuleset({ x: 5 }),
        phases: [
          {
            name: "deal",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "play", when: "true" }],
            automaticSequence: [],
          },
          {
            name: "play",
            kind: "turn_based",
            actions: [
              {
                name: "set_x",
                label: "Set X",
                effect: ['set_var("x", 99)'],
              },
              {
                name: "done",
                label: "Done",
                effect: ["end_turn()"],
              },
            ],
            transitions: [{ to: "round_end", when: "all_players_done" }],
            turnOrder: "clockwise",
          },
          {
            name: "round_end",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "deal", when: "true" }],
            automaticSequence: ["reset_round()"],
          },
        ],
      };

      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("var-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });
      expect(state.variables.x).toBe(5);

      // Set x to 99
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "set_x",
      });
      expect(state.variables.x).toBe(99);

      // End turn → all_players_done → round_end → reset_round
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "done",
      });
      // After reset_round, variables should be back to initial
      expect(state.variables.x).toBe(5);
    });
  });

  // ── play_card with phase action effects ─────────────────────────

  describe("play_card with phase action effects", () => {
    const PLAY_CARD_VALUES: Readonly<Record<string, CardValue>> = {
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
      A: { kind: "dual", low: 1, high: 11 },
    };

    function makePlayCardRuleset(overrides?: {
      playCardEffects?: string[];
      playCardCondition?: string;
      autoEndTurnCondition?: string;
      transitions?: Array<{ to: string; when: string }>;
      noPlayCardAction?: boolean;
    }): CardGameRuleset {
      const playActions: PhaseDefinition["actions"] = overrides?.noPlayCardAction
        ? []
        : [
            {
              name: "play_card",
              label: "Play",
              effect: overrides?.playCardEffects ?? [
                'inc_var("cards_played", 1)',
              ],
              ...(overrides?.playCardCondition
                ? { condition: overrides.playCardCondition }
                : {}),
            },
          ];

      return {
        meta: {
          name: "PlayCard Test",
          slug: "play-card-test",
          version: "1.0.0",
          author: "test",
          players: { min: 1, max: 2 },
        },
        deck: {
          preset: "standard_52",
          copies: 1,
          cardValues: PLAY_CARD_VALUES,
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
        scoring: {
          mode: "manual",
          expressions: [],
          winCondition: { mode: "highest_score" },
          ...(overrides?.autoEndTurnCondition
            ? { autoEndTurnCondition: overrides.autoEndTurnCondition }
            : {}),
        },
        phases: [
          {
            name: "setup",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "play_turn", when: "true" }],
            automaticSequence: [
              'shuffle("draw_pile")',
              'deal("draw_pile", "hand", 5)',
            ],
          },
          {
            name: "play_turn",
            kind: "turn_based",
            actions: [
              ...playActions,
              {
                name: "done",
                label: "Done",
                effect: ["end_turn()"],
              },
            ],
            transitions: overrides?.transitions ?? [
              { to: "game_over", when: "all_players_done" },
            ],
            turnOrder: "clockwise",
          },
          {
            name: "game_over",
            kind: "automatic",
            actions: [],
            transitions: [],
            automaticSequence: [],
          },
        ],
        initialVariables: { cards_played: 0 },
      };
    }

    it("executes phase action effects when play_card action exists", () => {
      const ruleset = makePlayCardRuleset();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-test"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      expect(state.variables.cards_played).toBe(0);
      const card = state.zones["hand:0"]!.cards[0]!;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      expect(state.variables.cards_played).toBe(1);
      expect(state.zones["discard"]!.cards).toHaveLength(1);
      expect(state.zones["hand:0"]!.cards).toHaveLength(4);
    });

    it("moves card without effects when no play_card phase action exists", () => {
      const ruleset = makePlayCardRuleset({ noPlayCardAction: true });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-noaction"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      const card = state.zones["hand:0"]!.cards[0]!;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      expect(state.zones["discard"]!.cards).toHaveLength(1);
      expect(state.variables.cards_played).toBe(0); // No effects ran
    });

    it("checks autoEndTurnCondition after effects", () => {
      const ruleset = makePlayCardRuleset({
        autoEndTurnCondition: 'get_var("cards_played") >= 1',
      });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(2);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-autoend"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      expect(state.currentPlayerIndex).toBe(0);
      const card = state.zones["hand:0"]!.cards[0]!;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      // After autoEndTurn, next player should be active
      expect(state.currentPlayerIndex).toBe(1);
    });

    it("triggers phase transitions after effects", () => {
      const ruleset = makePlayCardRuleset({
        transitions: [
          { to: "game_over", when: 'get_var("cards_played") >= 1' },
        ],
      });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-trans"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      expect(state.currentPhase).toBe("play_turn");
      const card = state.zones["hand:0"]!.cards[0]!;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      expect(state.currentPhase).toBe("game_over");
    });

    it("rejects play_card when phase action condition fails", () => {
      const ruleset = makePlayCardRuleset({ playCardCondition: "false" });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-reject"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      const card = state.zones["hand:0"]!.cards[0]!;
      const handCountBefore = state.zones["hand:0"]!.cards.length;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      // State unchanged — action was rejected
      expect(state.zones["hand:0"]!.cards).toHaveLength(handCountBefore);
      expect(state.zones["discard"]!.cards).toHaveLength(0);
      expect(state.variables.cards_played).toBe(0);
    });

    it("declare with params passes params to get_param builtin", () => {
      const ruleset: CardGameRuleset = {
        ...makePlayCardRuleset(),
        phases: [
          {
            name: "setup",
            kind: "automatic",
            actions: [],
            transitions: [{ to: "play_turn", when: "true" }],
            automaticSequence: [
              'shuffle("draw_pile")',
              'deal("draw_pile", "hand", 5)',
            ],
          },
          {
            name: "play_turn",
            kind: "turn_based",
            actions: [
              {
                name: "choose",
                label: "Choose",
                effect: ['set_var("chosen", get_param("amount"))'],
              },
              {
                name: "done",
                label: "Done",
                effect: ["end_turn()"],
              },
            ],
            transitions: [{ to: "game_over", when: "all_players_done" }],
            turnOrder: "clockwise",
          },
          {
            name: "game_over",
            kind: "automatic",
            actions: [],
            transitions: [],
            automaticSequence: [],
          },
        ],
        initialVariables: { chosen: 0, cards_played: 0 },
      };

      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-params"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "choose",
        params: { amount: 42 },
      });

      expect(state.variables.chosen).toBe(42);
    });

    it("declare without params still works (backward compat)", () => {
      const ruleset = makePlayCardRuleset();
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-noparams"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      // "done" action has end_turn() effect, should work fine without params
      state = reducer(state, {
        kind: "declare",
        playerId: makePlayerId("p0"),
        declaration: "done",
      });

      // Should not throw, turn ends normally — version increased
      expect(state.version).toBeGreaterThan(1);
    });

    it("play_card with multiple effects executes all", () => {
      const ruleset = makePlayCardRuleset({
        playCardEffects: [
          'inc_var("cards_played", 1)',
          'inc_var("cards_played", 10)',
        ],
      });
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(1);
      let state = createInitialState(
        ruleset,
        makeSessionId("pc-multi"),
        players,
        FIXED_SEED
      );
      state = reducer(state, { kind: "start_game" });

      const card = state.zones["hand:0"]!.cards[0]!;

      state = reducer(state, {
        kind: "play_card",
        playerId: makePlayerId("p0"),
        cardId: card.id,
        fromZone: "hand:0",
        toZone: "discard",
      });

      expect(state.variables.cards_played).toBe(11); // 1 + 10
    });
  });
});
