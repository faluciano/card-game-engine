// ─── Integration Test — Hearts Ruleset ─────────────────────────────
// Loads rulesets/hearts.cardgame.json from disk and plays scripted
// games through the real reducer with a fixed seed. Hearts exercises
// trick-taking: follow-suit validation via per-card `play_card`
// conditions, hearts breaking, trick resolution, penalty scoring
// (hearts 1, Q♠ 13), shooting the moon, and multi-round play to 100.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRuleset, createInitialState, createReducer } from "./interpreter";
import { getPlayableCardIndices } from "./action-validator";
import { registerAllBuiltins } from "./builtins";
import { evaluateExpression } from "./expression-evaluator";
import type {
  PlayerId,
  GameSessionId,
  Player,
  Card,
  CardGameState,
  GameReducer,
  CardGameRuleset,
} from "../types/index";

// ─── Fixture Setup ─────────────────────────────────────────────────

const RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/hearts.cardgame.json",
);

const FIXED_SEED = 42;
const PLAYER_COUNT = 4;

const PLAYERS: readonly Player[] = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
  id: `p${i + 1}` as PlayerId,
  name: `Player ${i + 1}`,
  role: "player",
  connected: true,
}));

function loadHearts(): CardGameRuleset {
  return loadRuleset(JSON.parse(readFileSync(RULESET_PATH, "utf-8")));
}

function startGame(seed = FIXED_SEED): {
  state: CardGameState;
  reducer: GameReducer;
  ruleset: CardGameRuleset;
} {
  const ruleset = loadHearts();
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(ruleset, "hearts-session" as GameSessionId, PLAYERS, seed);
  return { state: reducer(initial, { kind: "start_game" }), reducer, ruleset };
}

function playCard(
  reducer: GameReducer,
  state: CardGameState,
  playerIndex: number,
  card: Card,
): CardGameState {
  return reducer(state, {
    kind: "play_card",
    playerId: PLAYERS[playerIndex]!.id,
    cardId: card.id,
    fromZone: `hand:${playerIndex}`,
    toZone: `trick:${playerIndex}`,
  });
}

function hand(state: CardGameState, i: number): readonly Card[] {
  return state.zones[`hand:${i}`]!.cards;
}

function trickCardCount(state: CardGameState): number {
  let total = 0;
  for (let i = 0; i < PLAYER_COUNT; i++) total += state.zones[`trick:${i}`]!.cards.length;
  return total;
}

function isPointCard(card: Card): boolean {
  return card.suit === "hearts" || (card.rank === "Q" && card.suit === "spades");
}

function penaltyPoints(cards: readonly Card[]): number {
  return cards.reduce(
    (sum, c) =>
      sum + (c.suit === "hearts" ? 1 : 0) + (c.rank === "Q" && c.suit === "spades" ? 13 : 0),
    0,
  );
}

/**
 * Independent oracle for the Hearts play rules, used to cross-check the
 * ruleset's `play_card` condition as evaluated by the engine.
 */
function legalIndices(state: CardGameState, me: number): number[] {
  const cards = hand(state, me);
  const all = cards.map((_, i) => i);
  const firstTrick = state.variables.tricks_played === 0;
  const broken = state.variables.hearts_broken === 1;

  if (trickCardCount(state) === 0) {
    if (firstTrick) return all.filter((i) => cards[i]!.rank === "2" && cards[i]!.suit === "clubs");
    const nonHearts = all.filter((i) => cards[i]!.suit !== "hearts");
    return broken || nonHearts.length === 0 ? all : nonHearts;
  }

  const led = state.zones[`trick:${state.variables.lead_player}`]!.cards[0]!.suit;
  const follow = all.filter((i) => cards[i]!.suit === led);
  if (follow.length > 0) return follow;
  if (firstTrick) {
    const safe = all.filter((i) => !isPointCard(cards[i]!));
    return safe.length > 0 ? safe : all;
  }
  return all;
}

function expectedTrickWinner(state: CardGameState, ruleset: CardGameRuleset): number {
  const led = state.zones[`trick:${state.variables.lead_player}`]!.cards[0]!.suit;
  let best = -1;
  let bestValue = -1;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const card = state.zones[`trick:${i}`]!.cards[0]!;
    if (card.suit !== led) continue;
    const cv = ruleset.deck.cardValues[card.rank]!;
    const value = cv.kind === "fixed" ? cv.value : cv.high;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

/** Plays one card for the current player (first legal card), cross-checking legality. */
function playNext(
  reducer: GameReducer,
  ruleset: CardGameRuleset,
  state: CardGameState,
  checkRejections: boolean,
): CardGameState {
  const me = state.currentPlayerIndex;
  const legal = legalIndices(state, me);
  expect(getPlayableCardIndices(state, ruleset, me)).toEqual(legal);
  expect(legal.length).toBeGreaterThan(0);

  if (checkRejections) {
    const illegal = hand(state, me).findIndex((_, i) => !legal.includes(i));
    if (illegal !== -1) {
      expect(playCard(reducer, state, me, hand(state, me)[illegal]!)).toBe(state);
    }
    // Nobody else may play out of turn.
    const other = (me + 1) % PLAYER_COUNT;
    expect(playCard(reducer, state, other, hand(state, other)[0]!)).toBe(state);
  }

  const next = playCard(reducer, state, me, hand(state, me)[legal[0]!]!);
  expect(next).not.toBe(state);
  return next;
}

/** Plays a full 13-trick round; returns the state in `round_end` (or `game_over`). */
function playRound(reducer: GameReducer, ruleset: CardGameRuleset, start: CardGameState) {
  let state = start;
  let plays = 0;
  while (state.currentPhase === "play_trick" && plays < 52) {
    const before = state;
    state = playNext(reducer, ruleset, state, plays < 12);
    plays++;

    if (trickCardCount(before) === PLAYER_COUNT - 1) {
      // This play completed a trick: resolution ran automatically.
      const completed = { ...before, zones: { ...before.zones } };
      const me = before.currentPlayerIndex;
      const played = hand(before, me)[legalIndices(before, me)[0]!]!;
      completed.zones[`trick:${me}`] = { ...before.zones[`trick:${me}`]!, cards: [played] };
      const winner = expectedTrickWinner(completed, ruleset);

      expect(trickCardCount(state)).toBe(0);
      expect(state.variables.tricks_played).toBe(before.variables.tricks_played! + 1);
      if (state.currentPhase === "play_trick") {
        expect(state.variables.lead_player).toBe(winner);
        expect(state.currentPlayerIndex).toBe(winner);
      }
      expect(state.zones[`won:${winner}`]!.cards.length).toBe(
        before.zones[`won:${winner}`]!.cards.length + PLAYER_COUNT,
      );
    }
  }
  expect(plays).toBe(52);
  return state;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Hearts ruleset", () => {
  describe("loading", () => {
    it("loads and validates from disk", () => {
      const ruleset = loadHearts();
      expect(ruleset.meta.slug).toBe("hearts");
      expect(ruleset.meta.players).toEqual({ min: 4, max: 4 });
      expect(ruleset.phases.map((p) => p.name)).toEqual([
        "setup",
        "find_leader",
        "play_trick",
        "resolve_trick",
        "scoring",
        "round_end",
        "game_over",
      ]);
    });
  });

  describe("setup", () => {
    it("deals 13 cards each and gives the lead to the holder of the 2 of clubs", () => {
      const { state } = startGame();
      expect(state.currentPhase).toBe("play_trick");
      for (let i = 0; i < PLAYER_COUNT; i++) expect(hand(state, i)).toHaveLength(13);
      expect(state.zones.draw_pile!.cards).toHaveLength(0);

      const holder = [0, 1, 2, 3].find((i) =>
        hand(state, i).some((c) => c.rank === "2" && c.suit === "clubs"),
      );
      expect(holder).toBe(1); // seed 42
      expect(state.variables.lead_player).toBe(holder);
      expect(state.currentPlayerIndex).toBe(holder);
      expect(state.variables).toMatchObject({ tricks_played: 0, hearts_broken: 0 });
    });
  });

  describe("first trick", () => {
    it("forces the leader to open with the 2 of clubs", () => {
      const { state, reducer, ruleset } = startGame();
      const leader = state.currentPlayerIndex;
      const twoOfClubs = hand(state, leader).find((c) => c.rank === "2" && c.suit === "clubs")!;
      const twoIndex = hand(state, leader).indexOf(twoOfClubs);

      expect(getPlayableCardIndices(state, ruleset, leader)).toEqual([twoIndex]);

      const otherCard = hand(state, leader).find((c) => c !== twoOfClubs)!;
      expect(playCard(reducer, state, leader, otherCard)).toBe(state);

      const next = playCard(reducer, state, leader, twoOfClubs);
      expect(next.currentPhase).toBe("play_trick");
      expect(next.currentPlayerIndex).toBe((leader + 1) % PLAYER_COUNT);
      expect(next.zones[`trick:${leader}`]!.cards.map((c) => c.id)).toEqual([twoOfClubs.id]);
      expect(hand(next, leader)).toHaveLength(12);
    });

    it("requires following suit when able, and forbids point cards otherwise", () => {
      const { state, reducer, ruleset } = startGame();
      const leader = state.currentPlayerIndex;
      const twoOfClubs = hand(state, leader).find((c) => c.rank === "2" && c.suit === "clubs")!;
      const afterLead = playCard(reducer, state, leader, twoOfClubs);

      const follower = afterLead.currentPlayerIndex;
      const cards = hand(afterLead, follower);
      const clubs = cards.map((c, i) => (c.suit === "clubs" ? i : -1)).filter((i) => i !== -1);
      const playable = getPlayableCardIndices(afterLead, ruleset, follower);

      if (clubs.length > 0) {
        expect(playable).toEqual(clubs);
        const offSuit = cards.findIndex((c) => c.suit !== "clubs");
        expect(playCard(reducer, afterLead, follower, cards[offSuit]!)).toBe(afterLead);
      } else {
        expect(playable.every((i) => !isPointCard(cards[i]!))).toBe(true);
      }
    });

    it("resolves the trick to the highest club and lets the winner lead", () => {
      const { state, reducer, ruleset } = startGame();
      let s = state;
      for (let i = 0; i < PLAYER_COUNT - 1; i++) s = playNext(reducer, ruleset, s, false);
      expect(trickCardCount(s)).toBe(3);

      // Reconstruct the full trick to compute the expected winner independently.
      const last = s.currentPlayerIndex;
      const lastCard = hand(s, last)[legalIndices(s, last)[0]!]!;
      const full = { ...s, zones: { ...s.zones } };
      full.zones[`trick:${last}`] = { ...s.zones[`trick:${last}`]!, cards: [lastCard] };
      const winner = expectedTrickWinner(full, ruleset);

      const resolved = playNext(reducer, ruleset, s, false);
      expect(resolved.currentPhase).toBe("play_trick");
      expect(resolved.variables.tricks_played).toBe(1);
      expect(resolved.variables.lead_player).toBe(winner);
      expect(resolved.currentPlayerIndex).toBe(winner);
      expect(trickCardCount(resolved)).toBe(0);
      const won = resolved.zones[`won:${winner}`]!.cards;
      expect(won).toHaveLength(4);
      expect(won.every((c) => !c.faceUp)).toBe(true);
      expect(won.some((c) => c.id === lastCard.id)).toBe(true);
    });
  });

  describe("a full round", () => {
    it("plays 13 tricks with follow-suit enforced, breaks hearts, and scores 26 penalty points", () => {
      const { state, reducer, ruleset } = startGame();
      const end = playRound(reducer, ruleset, state);

      expect(end.currentPhase).toBe("round_end");
      expect(end.variables.tricks_played).toBe(13);
      expect(end.variables.hearts_broken).toBe(1);
      for (let i = 0; i < PLAYER_COUNT; i++) expect(hand(end, i)).toHaveLength(0);

      const won = [0, 1, 2, 3].map((i) => end.zones[`won:${i}`]!.cards);
      expect(won.reduce((sum, w) => sum + w.length, 0)).toBe(52);

      const scores = [0, 1, 2, 3].map((i) => end.scores[`player_score:${i}`]);
      expect(scores).toEqual(won.map(penaltyPoints));
      expect(scores).toEqual([0, 1, 5, 20]); // seed 42
      expect(scores.reduce((a, b) => a + b, 0)).toBe(26);
      for (let i = 0; i < PLAYER_COUNT; i++) {
        expect(end.variables[`cumulative_score_${i}`]).toBe(scores[i]);
      }
    });

    it("starts the next round from a fresh deal while keeping cumulative scores", () => {
      const { state, reducer, ruleset } = startGame();
      const end = playRound(reducer, ruleset, state);
      const next = reducer(end, {
        kind: "declare",
        playerId: PLAYERS[2]!.id,
        declaration: "next_round",
      });

      expect(next.currentPhase).toBe("play_trick");
      expect(next.turnNumber).toBe(2);
      expect(next.variables).toMatchObject({
        tricks_played: 0,
        hearts_broken: 0,
        cumulative_score_0: 0,
        cumulative_score_1: 1,
        cumulative_score_2: 5,
        cumulative_score_3: 20,
      });
      expect(next.scores).toEqual({});
      for (let i = 0; i < PLAYER_COUNT; i++) {
        expect(hand(next, i)).toHaveLength(13);
        expect(next.zones[`won:${i}`]!.cards).toHaveLength(0);
      }
      const holder = [0, 1, 2, 3].find((i) =>
        hand(next, i).some((c) => c.rank === "2" && c.suit === "clubs"),
      );
      expect(next.currentPlayerIndex).toBe(holder);
    });
  });

  describe("full game", () => {
    it("plays rounds until someone reaches 100 and the lowest score wins", () => {
      const { state, reducer, ruleset } = startGame();
      let s = state;
      let rounds = 0;
      while (s.status.kind === "in_progress" && rounds < 30) {
        s = playRound(reducer, ruleset, s);
        rounds++;
        if (s.currentPhase === "round_end") {
          const max = Math.max(...[0, 1, 2, 3].map((i) => s.variables[`cumulative_score_${i}`]!));
          expect(max).toBeLessThan(100);
          s = reducer(s, { kind: "declare", playerId: PLAYERS[0]!.id, declaration: "next_round" });
        }
      }

      expect(s.status.kind).toBe("finished");
      expect(s.currentPhase).toBe("game_over");
      expect(rounds).toBe(12); // seed 42
      const totals = [0, 1, 2, 3].map((i) => s.variables[`cumulative_score_${i}`]);
      expect(totals).toEqual([73, 81, 44, 114]);
      expect(Math.max(...(totals as number[]))).toBeGreaterThanOrEqual(100);

      expect([0, 1, 2, 3].map((i) => s.scores[`result:${i}`])).toEqual([-1, -1, 1, -1]);
      expect(s.status.kind === "finished" && s.status.winnerId).toBe("p3");
      // No further play accepted.
      expect(
        reducer(s, { kind: "declare", playerId: PLAYERS[0]!.id, declaration: "next_round" }),
      ).toBe(s);
    });
  });

  describe("shooting the moon", () => {
    it("scores 0 for the shooter and 26 for everyone else", () => {
      registerAllBuiltins();
      const { state, ruleset } = startGame();
      // Give player 0 every heart and the Queen of Spades; spread the rest around.
      const all = Object.values(state.zones).flatMap((z) => z.cards);
      const zones = { ...state.zones };
      for (let i = 0; i < PLAYER_COUNT; i++) {
        zones[`hand:${i}`] = { ...zones[`hand:${i}`]!, cards: [] };
        zones[`won:${i}`] = { ...zones[`won:${i}`]!, cards: [] };
      }
      const points = all.filter(isPointCard);
      const rest = all.filter((c) => !isPointCard(c));
      zones["won:0"] = { ...zones["won:0"]!, cards: points };
      zones["won:1"] = { ...zones["won:1"]!, cards: rest.slice(0, 12) };
      zones["won:2"] = { ...zones["won:2"]!, cards: rest.slice(12, 24) };
      zones["won:3"] = { ...zones["won:3"]!, cards: rest.slice(24) };
      const moon: CardGameState = { ...state, zones };
      expect(penaltyPoints(moon.zones["won:0"]!.cards)).toBe(26);

      const scores = [0, 1, 2, 3].map(
        (i) => evaluateExpression(ruleset.scoring.method, { state: moon, playerIndex: i }).value,
      );
      expect(scores).toEqual([0, 26, 26, 26]);
    });
  });
});
