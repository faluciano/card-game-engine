// ─── all_players_done() in an `all_players` (simultaneous) phase ─────
// Regression test for the historical "all_players_done sentinel always
// returns true" bug. In a simultaneous phase every human player must
// declare (each declaration ends that player's turn) before a transition
// guarded by `all_players_done()` may fire. One declaration must NOT
// advance the phase.

import { describe, it, expect, beforeEach } from "vitest";
import { createInitialState, createReducer } from "./interpreter";
import { clearBuiltins } from "./expression-evaluator";
import { registerAllBuiltins } from "./builtins";
import type { PlayerId, GameSessionId, Player, CardGameRuleset } from "../types/index";

const FIXED_SEED = 42;

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `Player ${i}`,
    role: "player",
    connected: true,
  }));
}

/**
 * Minimal ruleset: deal → ready (all_players, each player declares "ready"
 * which ends their turn) → scoring (automatic) → done (all_players, terminal).
 */
function makeSimultaneousRuleset(playerCount: number): CardGameRuleset {
  return {
    meta: {
      name: "Simultaneous Ready Test",
      slug: "simultaneous-ready-test",
      version: "1.0.0",
      author: "test",
      players: { min: playerCount, max: playerCount },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: { A: { kind: "fixed", value: 1 } },
    },
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
        transitions: [{ to: "ready", when: "all_hands_dealt" }],
        onEnter: ["shuffle(draw_pile)", "deal(draw_pile, hand, 1)"],
      },
      {
        name: "ready",
        kind: "all_players",
        actions: [{ name: "ready", label: "Ready", effect: ["end_turn()"] }],
        transitions: [{ to: "scoring", when: "all_players_done()" }],
      },
      {
        name: "scoring",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "done", when: "scores_calculated" }],
        onEnter: ["calculate_scores()"],
      },
      {
        name: "done",
        kind: "all_players",
        actions: [],
        transitions: [],
      },
    ],
    scoring: { method: "0", winCondition: "false" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

describe("all_players_done() gates a simultaneous phase", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  it.each([2, 3])(
    "with %i human players, the phase advances only after every player declares",
    (playerCount) => {
      const ruleset = makeSimultaneousRuleset(playerCount);
      const reducer = createReducer(ruleset, FIXED_SEED);
      const players = makePlayers(playerCount);
      let state = createInitialState(ruleset, "sim" as GameSessionId, players, FIXED_SEED);

      state = reducer(state, { kind: "start_game" });
      expect(state.currentPhase).toBe("ready");
      expect(state.turnsTakenThisPhase).toBe(0);

      // Declare in reverse order to prove turn ownership is not required
      // in an all_players phase and that the count is what matters.
      const order = [...players].reverse();
      order.forEach((player, i) => {
        const declaredSoFar = i + 1;
        state = reducer(state, {
          kind: "declare",
          playerId: player.id,
          declaration: "ready",
        });

        if (declaredSoFar < playerCount) {
          expect(state.currentPhase).toBe("ready");
          expect(state.turnsTakenThisPhase).toBe(declaredSoFar);
        }
      });

      // Only after the last declaration does the guarded transition fire,
      // then the automatic scoring phase runs through to "done".
      expect(state.currentPhase).toBe("done");
      expect(state.turnsTakenThisPhase).toBe(0);
    },
  );

  it("does not advance after a single declaration with 3 players", () => {
    const ruleset = makeSimultaneousRuleset(3);
    const reducer = createReducer(ruleset, FIXED_SEED);
    const players = makePlayers(3);
    let state = createInitialState(ruleset, "sim-single" as GameSessionId, players, FIXED_SEED);
    state = reducer(state, { kind: "start_game" });

    state = reducer(state, {
      kind: "declare",
      playerId: players[1]!.id,
      declaration: "ready",
    });

    expect(state.currentPhase).toBe("ready");
    expect(state.turnsTakenThisPhase).toBe(1);
  });
});
