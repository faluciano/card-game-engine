// ─── Paced Automatic Phase (`step_phase` + `onStep`) ───────────────
// Verifies the host-driven stepping mechanism that lets an automatic
// phase advance one step at a time (e.g., a dealer drawing one card per
// tick) instead of resolving instantly in a single reducer call.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRuleset, createInitialState, createReducer } from "./interpreter";
import { clearBuiltins } from "./expression-evaluator";
import { registerAllBuiltins } from "./builtins";
import type {
  PlayerId,
  GameSessionId,
  Player,
  CardGameState,
  GameReducer,
  CardGameRuleset,
  CardValue,
} from "../types/index";

// ─── Helpers ───────────────────────────────────────────────────────

function pid(id: string): PlayerId {
  return id as PlayerId;
}

function sid(id: string): GameSessionId {
  return id as GameSessionId;
}

function makePlayers(count: number, role = "player"): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: pid(`player-${i}`),
    name: `Player ${i}`,
    role,
    connected: true,
  }));
}

// ─── Generic Counter Ruleset ───────────────────────────────────────
// A minimal ruleset whose first (automatic) phase lingers, bumping a
// counter by one on each `step_phase` until it reaches 3, then advances.

function makeCounterRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Counter",
      slug: "counter",
      version: "1.0.0",
      author: "test",
      players: { min: 1, max: 1 },
    },
    deck: { preset: "standard_52", copies: 1, cardValues: {} },
    zones: [{ name: "draw_pile", visibility: { kind: "hidden" }, owners: [] }],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    variables: { counter: { type: "number", initial: 0 } },
    phases: [
      {
        name: "counting",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "done", when: "get_var(\"counter\") >= 3" }],
        onEnter: ["set_var(\"counter\", 0)"],
        onStep: ["set_var(\"counter\", get_var(\"counter\") + 1)"],
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

function startCounter(): {
  state: CardGameState;
  reducer: GameReducer;
} {
  const ruleset = makeCounterRuleset();
  const reducer = createReducer(ruleset, 1);
  const initial = createInitialState(ruleset, sid("s"), makePlayers(1), 1);
  const state = reducer(initial, { kind: "start_game" });
  return { state, reducer };
}

// ─── Blackjack (real on-disk ruleset) ──────────────────────────────

const RULESET_PATH = resolve(
  import.meta.dirname ?? __dirname,
  "../../../../rulesets/blackjack.cardgame.json",
);

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

function loadBlackjack(): CardGameRuleset {
  const raw = JSON.parse(readFileSync(RULESET_PATH, "utf-8"));
  return loadRuleset(raw);
}

/** Naive dealer hand value (aces high unless bust) for test assertions. */
function dealerHandValue(state: CardGameState): number {
  const cards = state.zones["dealer_hand"]!.cards;
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const value = BLACKJACK_CARD_VALUES[card.rank]!;
    if (value.kind === "dual") {
      total += value.high;
      aces += 1;
    } else if (value.kind === "fixed") {
      total += value.value;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

/**
 * Finds a seed where, after both players stand, the dealer's opening hand
 * is below 17 so the round *lingers* in `dealer_turn` awaiting steps.
 */
function findLingeringGame(
  ruleset: CardGameRuleset,
): { state: CardGameState; reducer: GameReducer; players: Player[] } {
  for (let seed = 1; seed < 500; seed++) {
    const players = makePlayers(2);
    const reducer = createReducer(ruleset, seed);
    const initial = createInitialState(ruleset, sid("s"), players, seed);
    let state = reducer(initial, { kind: "start_game" });
    state = reducer(state, {
      kind: "declare",
      playerId: players[0]!.id,
      declaration: "stand",
    });
    state = reducer(state, {
      kind: "declare",
      playerId: players[1]!.id,
      declaration: "stand",
    });
    if (state.currentPhase === "dealer_turn") {
      return { state, reducer, players };
    }
  }
  throw new Error("no lingering dealer seed found");
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("step_phase — generic paced automatic phase", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  it("lingers in the automatic phase after onEnter (no auto-resolve)", () => {
    const { state } = startCounter();
    expect(state.currentPhase).toBe("counting");
    expect(state.variables["counter"]).toBe(0);
  });

  it("applies onStep exactly once per step_phase action", () => {
    const { state, reducer } = startCounter();

    const s1 = reducer(state, { kind: "step_phase" });
    expect(s1.currentPhase).toBe("counting");
    expect(s1.variables["counter"]).toBe(1);

    const s2 = reducer(s1, { kind: "step_phase" });
    expect(s2.variables["counter"]).toBe(2);
    expect(s2.currentPhase).toBe("counting");
  });

  it("transitions out once the phase's condition is met", () => {
    const { state, reducer } = startCounter();
    let s = state;
    for (let i = 0; i < 3; i++) {
      s = reducer(s, { kind: "step_phase" });
    }
    expect(s.variables["counter"]).toBe(3);
    expect(s.currentPhase).toBe("done");
  });

  it("bumps the state version on each step", () => {
    const { state, reducer } = startCounter();
    const s1 = reducer(state, { kind: "step_phase" });
    expect(s1.version).toBeGreaterThan(state.version);
  });

  it("is a no-op in a non-automatic phase", () => {
    const { state, reducer } = startCounter();
    let s = state;
    for (let i = 0; i < 3; i++) s = reducer(s, { kind: "step_phase" });
    expect(s.currentPhase).toBe("done");

    const after = reducer(s, { kind: "step_phase" });
    expect(after).toBe(s); // same reference — untouched
  });
});

describe("step_phase — blackjack dealer pacing", () => {
  beforeEach(() => {
    clearBuiltins();
    registerAllBuiltins();
  });

  it("dealer_turn reveals without drawing, then lingers below 17", () => {
    const ruleset = loadBlackjack();
    const { state } = findLingeringGame(ruleset);

    expect(state.currentPhase).toBe("dealer_turn");
    // Only the opening two cards — no cards drawn on entry.
    expect(state.zones["dealer_hand"]!.cards).toHaveLength(2);
    // Both dealer cards are revealed face-up.
    expect(
      state.zones["dealer_hand"]!.cards.every((c) => c.faceUp),
    ).toBe(true);
    expect(dealerHandValue(state)).toBeLessThan(17);
  });

  it("draws one card per step until reaching 17+, then resolves", () => {
    const ruleset = loadBlackjack();
    const { state, reducer } = findLingeringGame(ruleset);

    let s = state;
    let prevCount = s.zones["dealer_hand"]!.cards.length;
    let steps = 0;

    while (s.currentPhase === "dealer_turn" && steps < 20) {
      s = reducer(s, { kind: "step_phase" });
      steps += 1;
      const count = s.zones["dealer_hand"]!.cards.length;
      // Each step adds at most one dealer card (paced, not bulk).
      expect(count - prevCount).toBeLessThanOrEqual(1);
      prevCount = count;
    }

    // Dealer left dealer_turn only after reaching a standing total.
    expect(s.currentPhase).not.toBe("dealer_turn");
    expect(dealerHandValue(s)).toBeGreaterThanOrEqual(17);
  });
});
