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
    variables: {},
    actionLog: [],
    turnsTakenThisPhase: 0,
    turnDirection: 1,
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

  // ══════════════════════════════════════════════════════════════════
  // ── Per-player zone ownership (index-based) ────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("per-player zone ownership by index", () => {
    /** Two players with per-player hand zones (hand:0, hand:1). */
    function twoPlayerHandState(
      overrides?: Partial<CardGameState>
    ): CardGameState {
      return createMockState({
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [QUEEN_DIAMONDS, JACK_CLUBS],
          },
        },
        ...overrides,
      });
    }

    it("player 0 sees own hand:0 cards", () => {
      const state = twoPlayerHandState();
      const view = createPlayerView(state, makePlayerId("alice"));

      expect(view.zones["hand:0"]!.cards).toEqual([ACE_SPADES, KING_HEARTS]);
      expect(view.zones["hand:0"]!.cardCount).toBe(2);
    });

    it("player 0 sees hand:1 as hidden (not owner)", () => {
      const state = twoPlayerHandState();
      const view = createPlayerView(state, makePlayerId("alice"));

      expect(view.zones["hand:1"]!.cards).toEqual([null, null]);
      expect(view.zones["hand:1"]!.cardCount).toBe(2);
    });

    it("player 1 sees own hand:1 cards", () => {
      const state = twoPlayerHandState();
      const view = createPlayerView(state, makePlayerId("bob"));

      expect(view.zones["hand:1"]!.cards).toEqual([
        QUEEN_DIAMONDS,
        JACK_CLUBS,
      ]);
      expect(view.zones["hand:1"]!.cardCount).toBe(2);
    });

    it("player 1 sees hand:0 as hidden (not owner)", () => {
      const state = twoPlayerHandState();
      const view = createPlayerView(state, makePlayerId("bob"));

      expect(view.zones["hand:0"]!.cards).toEqual([null, null]);
      expect(view.zones["hand:0"]!.cardCount).toBe(2);
    });

    it("per-player zone with public visibility shows to everyone", () => {
      const state = createMockState({
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        zones: {
          "score:0": {
            definition: {
              name: "score:0",
              visibility: { kind: "public" },
              owners: ["player"],
            },
            cards: [ACE_SPADES],
          },
        },
      });

      // Non-owner still sees public zone
      const view = createPlayerView(state, makePlayerId("bob"));
      expect(view.zones["score:0"]!.cards).toEqual([ACE_SPADES]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Shared zone ownership (role-based, unchanged) ──────────────
  // ══════════════════════════════════════════════════════════════════

  describe("shared zone ownership (role-based)", () => {
    it("shared zone without index suffix uses role-based matching", () => {
      const state = createMockState({
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
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
        zones: {
          draw_pile: {
            definition: {
              name: "draw_pile",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
        },
      });

      // Both players share the "player" role → both are owners
      const aliceView = createPlayerView(state, makePlayerId("alice"));
      expect(aliceView.zones["draw_pile"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
      ]);

      const bobView = createPlayerView(state, makePlayerId("bob"));
      expect(bobView.zones["draw_pile"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
      ]);

      // Dealer is not a "player" role → not an owner → hidden
      const dealerView = createPlayerView(state, makePlayerId("dealer"));
      expect(dealerView.zones["draw_pile"]!.cards).toEqual([null, null]);
    });

    it("zone named with colon but non-numeric suffix uses role-based matching", () => {
      const state = stateWithZone(
        "hand:abc",
        [ACE_SPADES],
        { kind: "owner_only" },
        ["player"]
      );
      const view = createPlayerView(state, makePlayerId("p1"));

      // "hand:abc" doesn't match /:(\d+)$/ → falls through to role-based
      // p1 has role "player" which is in owners → sees cards
      expect(view.zones["hand:abc"]!.cards).toEqual([ACE_SPADES]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Base name matching for visibility rules ────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("base name matching for visibility rules", () => {
    it("phase override targeting 'hand' applies to 'hand:0'", () => {
      const state = createMockState({
        currentPhase: "reveal",
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            {
              zone: "hand",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "public" },
              },
            },
          ],
        },
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      // During "reveal" phase, the "hand" base rule makes all hand zones public
      const bobView = createPlayerView(state, makePlayerId("bob"));

      // Bob can see Alice's hand:0 even though he's not the owner
      expect(bobView.zones["hand:0"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
      ]);
      // Bob can see his own hand:1 too (public overrides owner_only)
      expect(bobView.zones["hand:1"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("phase override targeting 'hand' applies to 'hand:1'", () => {
      const state = createMockState({
        currentPhase: "reveal",
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            {
              zone: "hand",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "public" },
              },
            },
          ],
        },
        zones: {
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [QUEEN_DIAMONDS, JACK_CLUBS],
          },
        },
      });

      // Alice (index 0) sees Bob's hand:1 because phase override → public
      const aliceView = createPlayerView(state, makePlayerId("alice"));
      expect(aliceView.zones["hand:1"]!.cards).toEqual([
        QUEEN_DIAMONDS,
        JACK_CLUBS,
      ]);
    });

    it("base name rule does NOT activate when phase doesn't match", () => {
      const state = createMockState({
        currentPhase: "player_turns",
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            {
              zone: "hand",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "public" },
              },
            },
          ],
        },
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES],
          },
        },
      });

      // During "player_turns", the override doesn't apply → default owner_only
      const bobView = createPlayerView(state, makePlayerId("bob"));
      expect(bobView.zones["hand:0"]!.cards).toEqual([null]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Exact name takes priority over base name ───────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("exact name takes priority over base name", () => {
    it("exact match 'hand:0' wins over base match 'hand'", () => {
      const state = createMockState({
        currentPhase: "reveal",
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            // Exact rule for hand:0 — stays hidden during reveal
            {
              zone: "hand:0",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "hidden" },
              },
            },
            // Base rule for hand — becomes public during reveal
            {
              zone: "hand",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "public" },
              },
            },
          ],
        },
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      const bobView = createPlayerView(state, makePlayerId("bob"));

      // hand:0 matches exact rule → override to hidden during "reveal"
      expect(bobView.zones["hand:0"]!.cards).toEqual([null, null]);

      // hand:1 has no exact rule → falls back to base "hand" rule → public
      expect(bobView.zones["hand:1"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("exact match found first even when base rule appears earlier in array", () => {
      const state = createMockState({
        currentPhase: "reveal",
        players: [
          {
            id: makePlayerId("alice"),
            name: "Alice",
            role: "player",
            connected: true,
          },
          {
            id: makePlayerId("bob"),
            name: "Bob",
            role: "player",
            connected: true,
          },
        ],
        ruleset: {
          ...createMockState().ruleset,
          visibility: [
            // Base rule appears FIRST in array
            {
              zone: "hand",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "public" },
              },
            },
            // Exact rule appears SECOND
            {
              zone: "hand:0",
              visibility: { kind: "owner_only" },
              phaseOverride: {
                phase: "reveal",
                visibility: { kind: "hidden" },
              },
            },
          ],
        },
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
            },
            cards: [ACE_SPADES],
          },
        },
      });

      const bobView = createPlayerView(state, makePlayerId("bob"));

      // Exact name "hand:0" rule takes priority over base "hand" rule,
      // regardless of array ordering. So hand:0 keeps owner_only visibility,
      // and bob (player 1) cannot see alice's (player 0) hand.
      expect(bobView.zones["hand:0"]!.cards).toEqual([null]);
    });
  });
});
