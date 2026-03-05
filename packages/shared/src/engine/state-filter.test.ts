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
    stringVariables: {},
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
      const state = createMockState({
        currentPhase: "player_turns",
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              owners: ["dealer"],
              phaseOverrides: [
                { phase: "dealer_turn", visibility: { kind: "public" } },
              ],
            },
            cards,
          },
        },
      });

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
      const state = createMockState({
        currentPhase: "dealer_turn",
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              owners: ["dealer"],
              phaseOverrides: [
                { phase: "dealer_turn", visibility: { kind: "public" } },
              ],
            },
            cards,
          },
        },
      });

      const view = createPlayerView(state, makePlayerId("p1"));

      // During dealer_turn, override makes it public → all cards visible
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
        QUEEN_DIAMONDS,
      ]);
    });

    it("does not override zones without phaseOverrides", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = createMockState({
        currentPhase: "dealer_turn",
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              owners: ["dealer"],
              phaseOverrides: [
                { phase: "dealer_turn", visibility: { kind: "public" } },
              ],
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

      // player_hand has no phaseOverrides → uses default owner_only
      // p1 is "player" role, which is an owner
      expect(view.zones["player_hand"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("uses default when zone has no phaseOverrides", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = createMockState({
        currentPhase: "dealer_turn",
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "partial", rule: "first_card_only" },
              owners: ["dealer"],
              // No phaseOverrides
            },
            cards,
          },
        },
      });

      const view = createPlayerView(state, makePlayerId("p1"));

      // No phaseOverrides → uses default partial rule
      expect(view.zones["dealer_hand"]!.cards).toEqual([
        ACE_SPADES,
        null,
      ]);
    });

    it("can override partial to hidden", () => {
      const cards = [ACE_SPADES, KING_HEARTS];
      const state = createMockState({
        currentPhase: "shuffle_phase",
        zones: {
          dealer_hand: {
            definition: {
              name: "dealer_hand",
              visibility: { kind: "public" },
              owners: ["dealer"],
              phaseOverrides: [
                { phase: "shuffle_phase", visibility: { kind: "hidden" } },
              ],
            },
            cards,
          },
        },
      });

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

  describe("zone-level phaseOverrides on per-player zones", () => {
    it("phaseOverrides on hand:0 applies during matching phase", () => {
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
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "public" } },
              ],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "public" } },
              ],
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      // During "reveal" phase, phaseOverrides make all hand zones public
      const bobView = createPlayerView(state, makePlayerId("bob"));

      // Bob can see Alice's hand:0 even though he's not the owner
      expect(bobView.zones["hand:0"]!.cards).toEqual([
        ACE_SPADES,
        KING_HEARTS,
      ]);
      // Bob can see his own hand:1 too (public overrides owner_only)
      expect(bobView.zones["hand:1"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("phaseOverrides on hand:1 applies during matching phase", () => {
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
        zones: {
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "public" } },
              ],
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

    it("phaseOverrides does NOT activate when phase doesn't match", () => {
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
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "public" } },
              ],
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

  describe("zone-specific phaseOverrides take precedence", () => {
    it("hand:0 with its own overrides differs from hand:1 with different overrides", () => {
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
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              // Specific override: stays hidden during reveal
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "hidden" } },
              ],
            },
            cards: [ACE_SPADES, KING_HEARTS],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              // Different override: becomes public during reveal
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "public" } },
              ],
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      const bobView = createPlayerView(state, makePlayerId("bob"));

      // hand:0 has override to hidden during "reveal"
      expect(bobView.zones["hand:0"]!.cards).toEqual([null, null]);

      // hand:1 has override to public during "reveal"
      expect(bobView.zones["hand:1"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });

    it("zone without phaseOverrides uses default visibility while sibling zone uses override", () => {
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
        zones: {
          "hand:0": {
            definition: {
              name: "hand:0",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              phaseOverrides: [
                { phase: "reveal", visibility: { kind: "hidden" } },
              ],
            },
            cards: [ACE_SPADES],
          },
          "hand:1": {
            definition: {
              name: "hand:1",
              visibility: { kind: "owner_only" },
              owners: ["player"],
              // No phaseOverrides — uses default
            },
            cards: [QUEEN_DIAMONDS],
          },
        },
      });

      const bobView = createPlayerView(state, makePlayerId("bob"));

      // hand:0 has phase override to hidden → hidden for bob
      expect(bobView.zones["hand:0"]!.cards).toEqual([null]);

      // hand:1 has no phaseOverrides → uses default owner_only
      // bob is index 1, so hand:1 is his → sees own cards
      expect(bobView.zones["hand:1"]!.cards).toEqual([QUEEN_DIAMONDS]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── publicVariables filtering (via variables manifest) ───────────
  // ══════════════════════════════════════════════════════════════════

  describe("publicVariables filtering", () => {
    it("exposes all variables when no variables are marked public", () => {
      const state = createMockState({
        variables: { score: 10, secret: 42 },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      expect(view.variables).toEqual({ score: 10, secret: 42 });
    });

    it("filters numeric variables to only public keys", () => {
      const baseRuleset = createMockState().ruleset;
      const state = createMockState({
        variables: { score: 10, secret: 42 },
        ruleset: {
          ...baseRuleset,
          variables: {
            score: { type: "number", initial: 0, public: true },
            secret: { type: "number", initial: 0 },
          },
        },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      expect(view.variables).toEqual({ score: 10 });
    });

    it("filters string variables to only public keys", () => {
      const baseRuleset = createMockState().ruleset;
      const state = createMockState({
        stringVariables: { status: "active", internalFlag: "x" },
        ruleset: {
          ...baseRuleset,
          variables: {
            status: { type: "string", initial: "", public: true },
            internalFlag: { type: "string", initial: "" },
          },
        },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      expect(view.stringVariables).toEqual({ status: "active" });
    });

    it("returns empty objects when all variables are non-public", () => {
      const baseRuleset = createMockState().ruleset;
      const state = createMockState({
        variables: { score: 10 },
        stringVariables: { status: "active" },
        ruleset: {
          ...baseRuleset,
          variables: {
            score: { type: "number", initial: 0, public: false },
            status: { type: "string", initial: "", public: false },
          },
        },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      expect(view.variables).toEqual({});
      expect(view.stringVariables).toEqual({});
    });

    it("handles public variables with non-existent runtime keys gracefully", () => {
      const baseRuleset = createMockState().ruleset;
      const state = createMockState({
        variables: { score: 10 },
        ruleset: {
          ...baseRuleset,
          variables: {
            nonexistent: { type: "number", initial: 0, public: true },
          },
        },
      });
      const view = createPlayerView(state, makePlayerId("p1"));
      expect(view.variables).toEqual({});
    });
  });
});
