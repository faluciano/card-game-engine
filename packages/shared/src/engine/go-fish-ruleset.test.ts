// ─── Integration Test — Go Fish Ruleset ────────────────────────────
// Loads rulesets/go-fish.cardgame.json from disk and plays scripted
// games through the real reducer with a fixed seed. Go Fish exercises
// declare actions with parameters (rank + target player), parameter
// validation in action conditions, the `move_rank` effect, draw-on-miss,
// go-again rules, and book (four-of-a-kind) collection.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRuleset, createInitialState, createReducer } from "./interpreter";
import { getValidActions } from "./action-validator";
import type { PlayerId, GameSessionId, Player, CardGameState, GameReducer } from "../types/index";

// ─── Fixture Setup ─────────────────────────────────────────────────

const RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/go-fish.cardgame.json",
);

const FIXED_SEED = 42;

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}` as PlayerId,
    name: `Player ${i + 1}`,
    role: "player",
    connected: true,
  }));
}

function loadGoFish() {
  return loadRuleset(JSON.parse(readFileSync(RULESET_PATH, "utf-8")));
}

function startGame(
  playerCount: number,
  seed = FIXED_SEED,
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  const ruleset = loadGoFish();
  const players = makePlayers(playerCount);
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(ruleset, "go-fish-session" as GameSessionId, players, seed);
  return { state: reducer(initial, { kind: "start_game" }), reducer, players };
}

function ask(
  reducer: GameReducer,
  state: CardGameState,
  playerIndex: number,
  rank: string,
  target: number,
): CardGameState {
  return reducer(state, {
    kind: "declare",
    playerId: state.players[playerIndex]!.id,
    declaration: "ask",
    params: { rank, target },
  });
}

function handSize(state: CardGameState, i: number): number {
  return state.zones[`hand:${i}`]!.cards.length;
}

function bookCount(state: CardGameState, i: number): number {
  return state.zones[`books:${i}`]!.cards.length / 4;
}

function countRank(state: CardGameState, zone: string, rank: string): number {
  return state.zones[zone]!.cards.filter((c) => c.rank === rank).length;
}

function totalCards(state: CardGameState): number {
  return Object.values(state.zones).reduce((sum, z) => sum + z.cards.length, 0);
}

/**
 * Omniscient scripted strategy: prefer asking a player who actually holds
 * one of our ranks (guarantees progress); every third ask deliberately
 * fishes so the draw path is exercised too.
 */
function chooseAsk(state: CardGameState, askNumber: number): { rank: string; target: number } {
  const n = state.players.length;
  const me = state.currentPlayerIndex;
  const hand = state.zones[`hand:${me}`]!.cards;
  let rank = hand[0]!.rank;
  let target = (me + 1) % n;
  if (askNumber % 3 === 0) {
    return { rank: hand[hand.length - 1]!.rank, target };
  }
  for (const card of hand) {
    for (let j = 0; j < n; j++) {
      if (j === me) continue;
      if (state.zones[`hand:${j}`]!.cards.some((c) => c.rank === card.rank)) {
        rank = card.rank;
        target = j;
        return { rank, target };
      }
    }
  }
  return { rank, target };
}

/** Plays a full game with the scripted strategy, checking rule invariants after every ask. */
function playFullGame(playerCount: number, seed: number) {
  let { state } = startGame(playerCount, seed);
  const { reducer } = startGame(playerCount, seed);
  const n = playerCount;
  let asks = 0;
  let catches = 0;
  let fishes = 0;
  let luckyFishes = 0;

  while (state.status.kind === "in_progress" && asks < 500) {
    const me = state.currentPlayerIndex;
    const { rank, target } = chooseAsk(state, asks);
    const targetHad = countRank(state, `hand:${target}`, rank);
    const pileTop = state.zones.draw_pile!.cards[0];

    const next = ask(reducer, state, me, rank, target);
    expect(next).not.toBe(state);
    asks++;

    // Rule: a catch keeps the turn; fishing the asked rank keeps the turn; otherwise it passes.
    const luckyFish = targetHad === 0 && pileTop !== undefined && pileTop.rank === rank;
    const keepsTurn = targetHad > 0 || luckyFish;
    if (targetHad > 0) catches++;
    else fishes++;
    if (luckyFish) luckyFishes++;
    expect(next.variables.last_catch).toBe(targetHad);

    if (next.status.kind === "in_progress") {
      // The turn holder is `me` on a catch, otherwise the next player — but a
      // player with an empty hand who cannot draw (empty pile) is skipped.
      let expected = keepsTurn ? me : (me + 1) % n;
      while (handSize(next, expected) === 0) expected = (expected + 1) % n;
      expect(next.currentPlayerIndex).toBe(expected);
      expect(next.currentPhase).toBe("player_turns");
      expect(handSize(next, next.currentPlayerIndex)).toBeGreaterThan(0);
    }

    // Rule: books are laid down as soon as they are completed; no hand ever holds four of a rank.
    for (let i = 0; i < n; i++) {
      const ranks = new Set(next.zones[`hand:${i}`]!.cards.map((c) => c.rank));
      for (const r of ranks) expect(countRank(next, `hand:${i}`, r)).toBeLessThan(4);
      expect(next.zones[`books:${i}`]!.cards.length % 4).toBe(0);
    }
    expect(totalCards(next)).toBe(52);
    // The ask is cleared once resolved.
    expect(next.stringVariables.asked_rank).toBe("");
    expect(next.variables.target).toBe(-1);

    state = next;
  }

  return { state, asks, catches, fishes, luckyFishes };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Go Fish ruleset", () => {
  describe("loading", () => {
    it("loads and validates from disk", () => {
      const ruleset = loadGoFish();
      expect(ruleset.meta.slug).toBe("go-fish");
      expect(ruleset.meta.players).toEqual({ min: 2, max: 4 });
      expect(ruleset.phases.map((p) => p.name)).toEqual([
        "setup",
        "turn_start",
        "skip_turn",
        "player_turns",
        "resolve_ask",
        "check_books",
        "game_over",
      ]);
    });
  });

  describe("setup", () => {
    it("deals 7 cards each to 2 players", () => {
      const { state } = startGame(2);
      expect(state.currentPhase).toBe("player_turns");
      expect(state.currentPlayerIndex).toBe(0);
      expect(handSize(state, 0)).toBe(7);
      expect(handSize(state, 1)).toBe(7);
      expect(state.zones.draw_pile!.cards).toHaveLength(38);
      expect(state.zones["books:0"]!.cards).toHaveLength(0);
    });

    it("deals 5 cards each to 3 and 4 players", () => {
      const three = startGame(3).state;
      expect([0, 1, 2].map((i) => handSize(three, i))).toEqual([5, 5, 5]);
      expect(three.zones.draw_pile!.cards).toHaveLength(37);

      const four = startGame(4).state;
      expect([0, 1, 2, 3].map((i) => handSize(four, i))).toEqual([5, 5, 5, 5]);
      expect(four.zones.draw_pile!.cards).toHaveLength(32);
    });

    it("offers the ask action to the current player only", () => {
      const { state, players } = startGame(2);
      expect(getValidActions(state, players[0]!.id)).toEqual([
        { actionName: "ask", label: "Ask for a rank", enabled: true },
      ]);
      expect(getValidActions(state, players[1]!.id)).toEqual([]);
    });
  });

  describe("asking", () => {
    it("rejects asking for a rank you do not hold", () => {
      const { state, reducer } = startGame(2);
      const held = new Set(state.zones["hand:0"]!.cards.map((c) => c.rank));
      const notHeld = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].find(
        (r) => !held.has(r),
      )!;
      expect(ask(reducer, state, 0, notHeld, 1)).toBe(state);
    });

    it("rejects asking yourself or a player index that does not exist", () => {
      const { state, reducer } = startGame(2);
      const rank = state.zones["hand:0"]!.cards[0]!.rank;
      expect(ask(reducer, state, 0, rank, 0)).toBe(state);
      expect(ask(reducer, state, 0, rank, 2)).toBe(state);
      expect(ask(reducer, state, 0, rank, -1)).toBe(state);
    });

    it("rejects asks from a player whose turn it is not", () => {
      const { state, reducer } = startGame(2);
      const rank = state.zones["hand:1"]!.cards[0]!.rank;
      expect(ask(reducer, state, 1, rank, 0)).toBe(state);
    });

    it("takes the matching cards on a hit and keeps the turn", () => {
      const { state, reducer } = startGame(2);
      // Seed 42: Player 1 holds a 3 and Player 2 holds exactly one 3.
      expect(countRank(state, "hand:0", "3")).toBe(1);
      expect(countRank(state, "hand:1", "3")).toBe(1);

      const next = ask(reducer, state, 0, "3", 1);

      expect(next.currentPhase).toBe("player_turns");
      expect(next.currentPlayerIndex).toBe(0);
      expect(handSize(next, 0)).toBe(8);
      expect(handSize(next, 1)).toBe(6);
      expect(countRank(next, "hand:0", "3")).toBe(2);
      expect(countRank(next, "hand:1", "3")).toBe(0);
      expect(next.zones.draw_pile!.cards).toHaveLength(38);
      expect(next.variables.last_catch).toBe(1);
    });

    it("draws from the pile on a miss and passes the turn", () => {
      const { state, reducer } = startGame(2);
      const afterHit = ask(reducer, state, 0, "3", 1);
      // Seed 42: Player 2 holds no 9, and the top of the pile is not a 9.
      expect(countRank(afterHit, "hand:0", "9")).toBeGreaterThan(0);
      expect(countRank(afterHit, "hand:1", "9")).toBe(0);
      const pileTop = afterHit.zones.draw_pile!.cards[0]!;
      expect(pileTop.rank).not.toBe("9");

      const next = ask(reducer, afterHit, 0, "9", 1);

      expect(next.currentPhase).toBe("player_turns");
      expect(next.currentPlayerIndex).toBe(1);
      expect(handSize(next, 0)).toBe(9);
      expect(handSize(next, 1)).toBe(6);
      expect(next.zones.draw_pile!.cards).toHaveLength(37);
      // The drawn card is the former top of the pile, appended to the hand.
      expect(next.zones["hand:0"]!.cards[8]!.id).toBe(pileTop.id);
      expect(next.variables.last_catch).toBe(0);
    });
  });

  describe("full game", () => {
    it("plays a 2-player game to completion with 13 books and a winner", () => {
      const { state, asks, catches, fishes, luckyFishes } = playFullGame(2, FIXED_SEED);

      expect(state.status.kind).toBe("finished");
      expect(state.currentPhase).toBe("game_over");
      expect(asks).toBe(52);
      expect(catches).toBeGreaterThan(0);
      expect(fishes).toBeGreaterThan(0);
      expect(luckyFishes).toBeGreaterThan(0);

      expect(bookCount(state, 0) + bookCount(state, 1)).toBe(13);
      expect(handSize(state, 0) + handSize(state, 1)).toBe(0);
      expect(state.zones.draw_pile!.cards).toHaveLength(0);

      expect(state.scores["player_score:0"]).toBe(5);
      expect(state.scores["player_score:1"]).toBe(8);
      expect(state.scores["result:0"]).toBe(-1);
      expect(state.scores["result:1"]).toBe(1);
      expect(state.status.kind === "finished" && state.status.winnerId).toBe("p2");
    });

    it("plays 3- and 4-player games to completion", () => {
      for (const n of [3, 4]) {
        const { state } = playFullGame(n, FIXED_SEED);
        expect(state.status.kind).toBe("finished");
        const books = Array.from({ length: n }, (_, i) => bookCount(state, i));
        expect(books.reduce((a, b) => a + b, 0)).toBe(13);
        const winnerIndex = state.players.findIndex(
          (p) => state.status.kind === "finished" && p.id === state.status.winnerId,
        );
        expect(books[winnerIndex]).toBe(Math.max(...books));
        for (let i = 0; i < n; i++) {
          expect(state.scores[`player_score:${i}`]).toBe(books[i]);
        }
      }
    });
  });
});
