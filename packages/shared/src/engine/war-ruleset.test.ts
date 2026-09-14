// ─── Integration Test — War Ruleset ────────────────────────────────
// Loads rulesets/war.cardgame.json from disk and plays scripted games
// through the real reducer with a fixed seed. War exercises the
// simultaneous (`all_players`) phase kind, cross-zone rank comparison,
// tie → war → burn flows, and pile replenishment.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInitialState, createReducer } from "./interpreter";
import { loadRuleset } from "../schema/index";
import type { PlayerId, GameSessionId, Player, CardGameState, GameReducer } from "../types/index";

// ─── Fixture Setup ─────────────────────────────────────────────────

const RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/war.cardgame.json",
);

/** Seed 1 produces a short game (64 battles, 2 wars) — ideal for scripted assertions. */
const FIXED_SEED = 1;

const PLAYERS: readonly Player[] = [
  { id: "p1" as PlayerId, name: "Alice", role: "player", connected: true },
  { id: "p2" as PlayerId, name: "Bob", role: "player", connected: true },
];

function loadWar() {
  return loadRuleset(JSON.parse(readFileSync(RULESET_PATH, "utf-8")));
}

function startGame(seed = FIXED_SEED): { state: CardGameState; reducer: GameReducer } {
  const ruleset = loadWar();
  const reducer = createReducer(ruleset, seed);
  const initial = createInitialState(ruleset, "war-session" as GameSessionId, PLAYERS, seed);
  return { state: reducer(initial, { kind: "start_game" }), reducer };
}

function flip(reducer: GameReducer, state: CardGameState, playerIndex: number): CardGameState {
  return reducer(state, {
    kind: "declare",
    playerId: PLAYERS[playerIndex]!.id,
    declaration: "flip",
  });
}

/** Both players flip; the second flip triggers resolution and returns to `battle`. */
function playBattle(reducer: GameReducer, state: CardGameState): CardGameState {
  return flip(reducer, flip(reducer, state, 0), 1);
}

function cardsHeld(state: CardGameState, playerIndex: number): number {
  return (
    state.zones[`deck:${playerIndex}`]!.cards.length +
    state.zones[`won:${playerIndex}`]!.cards.length
  );
}

function totalCards(state: CardGameState): number {
  return Object.values(state.zones).reduce((sum, z) => sum + z.cards.length, 0);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("War ruleset", () => {
  describe("loading", () => {
    it("loads and validates from disk", () => {
      const ruleset = loadWar();
      expect(ruleset.meta.slug).toBe("war");
      expect(ruleset.meta.players).toEqual({ min: 2, max: 2 });
      expect(ruleset.phases.map((p) => p.name)).toEqual([
        "setup",
        "battle",
        "resolve",
        "war",
        "replenish",
        "burn",
        "game_over",
      ]);
      expect(ruleset.phases.find((p) => p.name === "battle")!.kind).toBe("all_players");
    });
  });

  describe("setup", () => {
    it("deals 26 cards to each player's deck and enters the battle phase", () => {
      const { state } = startGame();
      expect(state.currentPhase).toBe("battle");
      expect(state.zones["deck:0"]!.cards).toHaveLength(26);
      expect(state.zones["deck:1"]!.cards).toHaveLength(26);
      expect(state.zones.draw_pile!.cards).toHaveLength(0);
      expect(state.zones["battle:0"]!.cards).toHaveLength(0);
      expect(state.zones.pot!.cards).toHaveLength(0);
      expect(state.variables).toMatchObject({ at_war: 0, battles: 0, wars: 0 });
    });
  });

  describe("a single battle", () => {
    it("lets either player flip first, face-up, without resolving the battle", () => {
      const { state, reducer } = startGame();
      const afterBob = flip(reducer, state, 1);

      expect(afterBob.currentPhase).toBe("battle");
      expect(afterBob.zones["deck:1"]!.cards).toHaveLength(25);
      expect(afterBob.zones["battle:1"]!.cards).toHaveLength(1);
      expect(afterBob.zones["battle:1"]!.cards[0]!.faceUp).toBe(true);
      expect(afterBob.zones["battle:0"]!.cards).toHaveLength(0);
      expect(afterBob.variables.battles).toBe(0);
    });

    it("rejects a second flip from a player who already flipped", () => {
      const { state, reducer } = startGame();
      const afterFirst = flip(reducer, state, 0);
      const afterSecond = flip(reducer, afterFirst, 0);
      expect(afterSecond).toBe(afterFirst);
    });

    it("resolves once both have flipped: the higher card takes both cards", () => {
      const { state, reducer } = startGame();
      const midBattle = flip(reducer, state, 0);
      const afterBob = flip(reducer, midBattle, 1);

      const aliceCard = midBattle.zones["battle:0"]!.cards[0]!;

      // Resolution ran automatically and we are back in the battle phase.
      expect(afterBob.currentPhase).toBe("battle");
      expect(afterBob.variables.battles).toBe(1);
      expect(afterBob.variables.wars).toBe(0);
      expect(afterBob.zones["battle:0"]!.cards).toHaveLength(0);
      expect(afterBob.zones["battle:1"]!.cards).toHaveLength(0);

      // Exactly one player gained two cards in their won pile.
      const won0 = afterBob.zones["won:0"]!.cards.length;
      const won1 = afterBob.zones["won:1"]!.cards.length;
      expect([won0, won1].sort()).toEqual([0, 2]);
      expect(cardsHeld(afterBob, 0) + cardsHeld(afterBob, 1)).toBe(52);

      // The winner's pile contains the card Alice flipped, face-down again.
      const winnerPile = won0 === 2 ? afterBob.zones["won:0"]! : afterBob.zones["won:1"]!;
      const collected = winnerPile.cards.find((c) => c.id === aliceCard.id);
      expect(collected).toBeDefined();
      expect(collected!.faceUp).toBe(false);
    });
  });

  describe("war on a tie", () => {
    it("moves the tied cards and three burned cards each into the pot, then awards it all", () => {
      let { state } = startGame();
      const { reducer } = startGame();

      // Seed 1: the first tie happens on the 12th battle.
      while (state.variables.wars === 0) {
        state = playBattle(reducer, state);
      }
      expect(state.variables.battles).toBe(12);
      expect(state.variables.wars).toBe(1);

      // The automatic chain ran resolve → war → replenish → burn → battle.
      expect(state.currentPhase).toBe("battle");
      expect(state.variables.at_war).toBe(0);
      // 2 tied cards + 3 face-down burns from each deck
      expect(state.zones.pot!.cards).toHaveLength(8);
      expect(state.zones.pot!.cards.every((c) => !c.faceUp)).toBe(true);
      expect(totalCards(state)).toBe(52);

      const heldBefore = [cardsHeld(state, 0), cardsHeld(state, 1)];

      // The next battle decides the war and pays out the pot.
      const afterWar = playBattle(reducer, state);
      expect(afterWar.zones.pot!.cards).toHaveLength(0);
      expect(afterWar.variables.battles).toBe(13);
      const heldAfter = [cardsHeld(afterWar, 0), cardsHeld(afterWar, 1)];
      const gains = heldAfter.map((h, i) => h - heldBefore[i]!);
      // The winner gains the 8-card pot plus both fresh flips (10), the loser loses their flip.
      expect(gains.sort((a, b) => a - b)).toEqual([-1, 9]);
    });
  });

  describe("full game", () => {
    it("plays to completion, refilling decks from won piles, and crowns the player with all cards", () => {
      let { state } = startGame();
      const { reducer } = startGame();

      let flips = 0;
      let replenishSeen = false;
      const phasesSeen = new Set<string>();
      while (state.status.kind === "in_progress" && flips < 5000) {
        for (let i = 0; i < 2; i++) {
          const next = flip(reducer, state, i);
          if (next !== state) flips++;
          // A deck only grows when an empty deck is refilled from the won pile.
          for (let p = 0; p < 2; p++) {
            if (next.zones[`deck:${p}`]!.cards.length > state.zones[`deck:${p}`]!.cards.length) {
              replenishSeen = true;
            }
          }
          state = next;
          phasesSeen.add(state.currentPhase);
        }
        expect(totalCards(state)).toBe(52);
      }

      expect(state.status.kind).toBe("finished");
      expect(state.currentPhase).toBe("game_over");
      expect(phasesSeen).toEqual(new Set(["battle", "game_over"]));
      expect(replenishSeen).toBe(true);
      expect(state.variables.battles).toBe(64);
      expect(state.variables.wars).toBe(2);
      expect(flips).toBe(128);

      // Bob (p2) wins with every card; Alice has none left.
      expect(state.scores["player_score:0"]).toBe(0);
      expect(state.scores["player_score:1"]).toBe(52);
      expect(state.scores["result:0"]).toBe(-1);
      expect(state.scores["result:1"]).toBe(1);
      expect(state.variables.cumulative_score_1).toBe(52);
      expect(state.status.kind === "finished" && state.status.winnerId).toBe("p2");

      // No more flips are accepted once the game is over.
      expect(flip(reducer, state, 1)).toBe(state);
    });

    it("is deterministic for the same seed", () => {
      const runs = [0, 1].map(() => {
        let { state } = startGame(42);
        const { reducer } = startGame(42);
        let flips = 0;
        while (state.status.kind === "in_progress" && flips < 5000) {
          for (let i = 0; i < 2; i++) {
            const next = flip(reducer, state, i);
            if (next !== state) flips++;
            state = next;
          }
        }
        return { flips, battles: state.variables.battles, scores: state.scores };
      });
      expect(runs[0]).toEqual(runs[1]);
      expect(runs[0]!.scores["result:1"]).toBe(1);
    });
  });
});
