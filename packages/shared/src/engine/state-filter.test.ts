import { describe, it, expect } from "vitest";
import { createPlayerView } from "./state-filter";
import type {
  Card,
  CardGameState,
  CardInstanceId,
  GameSessionId,
  PlayerId,
  ZoneVisibility,
} from "../types/index";

// ─── Test Helpers ──────────────────────────────────────────────────

function makeSessionId(id: string): GameSessionId {
  return id as GameSessionId;
}

function makePlayerId(id: string): PlayerId {
  return id as PlayerId;
}

function makeCardId(id: string): CardInstanceId {
  return id as CardInstanceId;
}

function makeCard(
  id: string,
  rank: string,
  suit: string,
  faceUp = false
): Card {
  return {
    id: makeCardId(id),
    rank,
    suit,
    faceUp,
  };
}

const ACE_SPADES = makeCard("c1", "A", "spades", true);
const KING_HEARTS = makeCard("c2", "K", "hearts", false);
const QUEEN_DIAMONDS = makeCard("c3", "Q", "diamonds", false);
const JACK_CLUBS = makeCard("c4", "J", "clubs", true);
const TEN_SPADES = makeCard("c5", "10", "spades", false);

function createMockState(
  overrides?: Partial<CardGameState>
): CardGameState {
  return {
    sessionId: makeSessionId("test-session"),
    ruleset: {
      meta: {
        name: "Test Game",
        slug: "test-game",
        version: "1.0.0",
        author: "test",
        players: { min: 1, max: 6 },
      },
      deck: { preset: "standard_52", copies: 1, cardValues: {} },
      zones: [],
      roles: [],
      phases: [
        {
          name: "player_turns",
          kind: "turn_based",
          actions: [],
          transitions: [],
        },
        {
          name: "dealer_turn",
          kind: "automatic",
          actions: [],
          transitions: [],
        },
      ],
      scoring: {
        method: "none",
        winCondition: "true",
        bustCondition: "false",
      },
      visibility: [],
      ui: { layout: "semicircle", tableColor: "felt_green" },
    } as CardGameState["ruleset"],
    status: { kind: "in_progress", startedAt: 0 },
    players: [
      {
        id: makePlayerId("p1"),
        name: "Alice",
        role: "player",
        connected: true,
      },
      {
        id: makePlayerId("dealer"),
        name: "Dealer",
        role: "dealer",
        connected: true,
      },
    ],
    zones: {},
    currentPhase: "player_turns",
    currentPlayerIndex: 0,
    turnNumber: 1,
    scores: {},
    actionLog: [],
    turnsTakenThisPhase: 0,
    version: 1,
    ...overrides,
  } as CardGameState;
}

function stateWithZone(
  zoneName: string,
  cards: readonly Card[],
  visibility: ZoneVisibility,
  owners: readonly string[] = [],
  overrides?: Partial<CardGameState>
): CardGameState {
  return createMockState({
    zones: {
      [zoneName]: {
        definition: { name: zoneName, visibility, owners },
        cards,
      },
    },
    ...overrides,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("state-filter", () => {
  // ══════════════════════════════════════════════════════════════════
  // ── createPlayerView basics ────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("createPlayerView", () => {
    it("throws for unknown player", () => {
      const state = createMockState();
      expect(() =>
        createPlayerView(state, makePlayerId("unknown"))
      ).toThrow("Player not found: unknown");
    });

    it("returns correct player metadata", () => {
      const state = stateWithZone(
        "table",
        [],
        { kind: "public" }
      );
      const view = createPlayerView(state, makePlayerId("p1"));

      expect(view.sessionId).toBe("test-session");
      expect(view.myPlayerId).toBe("p1");
      expect(view.isMyTurn).toBe(true);
      expect(view.currentPhase).toBe("player_turns");
    });

    it("remaps player_score:N keys to PlayerId", () => {
      const state = createMockState({
        scores: {
          "player_score:0": 18,
          "dealer_score": 20,
          "result:0": -1,
        },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      // player_score:0 → remapped to player's ID
      expect(view.scores["p1"]).toBe(18);
      // dealer_score passes through unchanged
      expect(view.scores["dealer_score"]).toBe(20);
      // result:0 → remapped to result:playerId
      expect(view.scores["result:p1"]).toBe(-1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Public visibility ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("public visibility", () => {
    it("shows all cards", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = stateWithZone("table", cards, { kind: "public" });
      const view = createPlayerView(state, makePlayerId("p1"));

      expect(view.zones["table"]!.cards).toEqual(cards);
      expect(view.zones["table"]!.cardCount).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Owner-only visibility ──────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("owner_only visibility", () => {
    it("shows cards to the owner", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = stateWithZone("hand", cards, {
        kind: "owner_only",
      }, ["player"]);
      const view = createPlayerView(state, makePlayerId("p1"));

      expect(view.zones["hand"]!.cards).toEqual(cards);
    });

    it("hides cards from non-owners", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = stateWithZone("hand", cards, {
        kind: "owner_only",
      }, ["player"]);
      const view = createPlayerView(state, makePlayerId("dealer"));

      expect(view.zones["hand"]!.cards).toEqual([null, null]);
      expect(view.zones["hand"]!.cardCount).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Hidden visibility ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("hidden visibility", () => {
    it("hides all cards from everyone", () => {
      const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS];
      const state = stateWithZone("draw_pile", cards, { kind: "hidden" });
      const view = createPlayerView(state, makePlayerId("p1"));

      expect(view.zones["draw_pile"]!.cards).toEqual([null, null, null]);
      expect(view.zones["draw_pile"]!.cardCount).toBe(3);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Partial visibility ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("partial visibility", () => {
    describe("first_card_only", () => {
      it("shows only the first card", () => {
        const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS];
        const state = stateWithZone("dealer_hand", cards, {
          kind: "partial",
          rule: "first_card_only",
        }, ["dealer"]);
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["dealer_hand"]!.cards).toEqual([
          ACE_SPADES,
          null,
          null,
        ]);
        expect(view.zones["dealer_hand"]!.cardCount).toBe(3);
      });

      it("shows the single card when zone has one card", () => {
        const cards = [ACE_SPADES];
        const state = stateWithZone("dealer_hand", cards, {
          kind: "partial",
          rule: "first_card_only",
        }, ["dealer"]);
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["dealer_hand"]!.cards).toEqual([ACE_SPADES]);
      });

      it("returns empty array for empty zone", () => {
        const state = stateWithZone("dealer_hand", [], {
          kind: "partial",
          rule: "first_card_only",
        }, ["dealer"]);
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["dealer_hand"]!.cards).toEqual([]);
        expect(view.zones["dealer_hand"]!.cardCount).toBe(0);
      });
    });

    describe("last_card_only", () => {
      it("shows only the last card", () => {
        const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS];
        const state = stateWithZone("discard", cards, {
          kind: "partial",
          rule: "last_card_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["discard"]!.cards).toEqual([
          null,
          null,
          QUEEN_DIAMONDS,
        ]);
        expect(view.zones["discard"]!.cardCount).toBe(3);
      });

      it("shows the single card when zone has one card", () => {
        const cards = [ACE_SPADES];
        const state = stateWithZone("discard", cards, {
          kind: "partial",
          rule: "last_card_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["discard"]!.cards).toEqual([ACE_SPADES]);
      });

      it("returns empty array for empty zone", () => {
        const state = stateWithZone("discard", [], {
          kind: "partial",
          rule: "last_card_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["discard"]!.cards).toEqual([]);
        expect(view.zones["discard"]!.cardCount).toBe(0);
      });
    });

    describe("face_up_only", () => {
      it("shows only face-up cards", () => {
        const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS];
        // ACE_SPADES (faceUp=true), KING_HEARTS (false), QUEEN_DIAMONDS (false), JACK_CLUBS (true)
        const state = stateWithZone("table", cards, {
          kind: "partial",
          rule: "face_up_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["table"]!.cards).toEqual([
          ACE_SPADES,
          null,
          null,
          JACK_CLUBS,
        ]);
        expect(view.zones["table"]!.cardCount).toBe(4);
      });

      it("hides all cards when none are face up", () => {
        const cards = [KING_HEARTS, QUEEN_DIAMONDS, TEN_SPADES];
        const state = stateWithZone("table", cards, {
          kind: "partial",
          rule: "face_up_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["table"]!.cards).toEqual([null, null, null]);
      });

      it("shows all cards when all are face up", () => {
        const allFaceUp = [ACE_SPADES, JACK_CLUBS]; // both have faceUp=true
        const state = stateWithZone("table", allFaceUp, {
          kind: "partial",
          rule: "face_up_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["table"]!.cards).toEqual([ACE_SPADES, JACK_CLUBS]);
      });

      it("returns empty array for empty zone", () => {
        const state = stateWithZone("table", [], {
          kind: "partial",
          rule: "face_up_only",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["table"]!.cards).toEqual([]);
      });
    });

    describe("unknown rule", () => {
      it("hides all cards as conservative default", () => {
        const cards = [ACE_SPADES, KING_HEARTS];
        const state = stateWithZone("mystery", cards, {
          kind: "partial",
          rule: "some_future_rule",
        });
        const view = createPlayerView(state, makePlayerId("p1"));

        expect(view.zones["mystery"]!.cards).toEqual([null, null]);
        expect(view.zones["mystery"]!.cardCount).toBe(2);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Phase override visibility ──────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("phase override visibility", () => {
    it("uses default visibility when phase does not match override", () => {
      const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS];
      const state = stateWithZone(
        "dealer_hand",
        cards,
        { kind: "partial", rule: "first_card_only" },
        ["dealer"],
        {
          currentPhase: "player_turns",
          ruleset: {
            ...createMockState().ruleset,
            visibility: [
              {
                zone: "dealer_hand",
                visibility: { kind: "partial", rule: "first_card_only" },
                phaseOverride: {
                  phase: "dealer_turn",
                  visibility: { kind: "public" },
                },
              },
            ],
          },
        }
      );

      const view = createPlayerView(state, makePlayerId("p1"));

      // During player_turns, partial rule applies → only first card visible
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        null,
        null,
      ]);
    });

    it("uses override visibility when phase matches", () => {
      const cards = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS];
      const state = stateWithZone(
        "dealer_hand",
        cards,
        { kind: "partial", rule: "first_card_only" },
        ["dealer"],
        {
          currentPhase: "dealer_turn",
          ruleset: {
            ...createMockState().ruleset,
            visibility: [
              {
                zone: "dealer_hand",
                visibility: { kind: "partial", rule: "first_card_only" },
                phaseOverride: {
                  phase: "dealer_turn",
                  visibility: { kind: "public" },
                },
              },
            ],
          },
        }
      );

      const view = createPlayerView(state, makePlayerId("p1"));

      // During dealer_turn, override makes it public → all cards visible
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
        QUEEN_DIAMONDS,
      ]);
    });

    it("does not override zones without a matching rule", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = createMockState({
        currentPhase: "dealer_turn",
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            {
              zone: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              phaseOverride: {
                phase: "dealer_turn",
                visibility: { kind: "public" },
              },
            },
          ],
        },
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              owners: ["dealer"],
            },
            cards,
          },
          player_hand: {
            definition: {
              name: "player_hand",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      const view = createPlayerView(state, makePlayerId("p1"));

      // dealer_hand override applies → public
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
      ]);

      // player_hand has no visibility rule → uses default owner_only
      // p1 is "player" role, which is an owner
      expect(view.zones["player_hand"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("uses default when visibility rule has no phaseOverride", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = stateWithZone(
        "dealer_hand",
        cards,
        { kind: "partial", rule: "first_card_only" },
        ["dealer"],
        {
          currentPhase: "dealer_turn",
          ruleset: {
            ...createMockState().ruleset,
            visibility: [
              {
                zone: "dealer_hand",
                visibility: { kind: "partial", rule: "first_card_only" },
                // No phaseOverride
              },
            ],
          },
        }
      );

      const view = createPlayerView(state, makePlayerId("p1"));

      // No phaseOverride → uses default partial rule
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        null,
      ]);
    });

    it("can override partial to hidden", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = stateWithZone(
        "dealer_hand",
        cards,
        { kind: "public" },
        ["dealer"],
        {
          currentPhase: "shuffle_phase",
          ruleset: {
            ...createMockState().ruleset,
            visibility: [
              {
                zone: "dealer_hand",
                visibility: { kind: "public" },
                phaseOverride: {
                  phase: "shuffle_phase",
                  visibility: { kind: "hidden" },
                },
              },
            ],
          },
        }
      );

      const view = createPlayerView(state, makePlayerId("p1"));

      // During shuffle_phase, override hides everything
      expect(view.zones["dealer_hand"]!.cards).toEqual([null, null]);
    });
  });
});
