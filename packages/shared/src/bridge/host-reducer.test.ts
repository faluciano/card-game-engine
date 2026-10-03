import { describe, it, expect } from "vitest";
import type { HostGameState, HostScreen } from "./host-state";
import type { CardGameAction, CardGameRuleset, CardGameState, PlayerId } from "../types/index";
import { createHostInitialState, deriveStatus, hostReducer } from "./host-reducer";

// ─── Fixtures ──────────────────────────────────────────────────────

/**
 * deal (automatic) → reveal (automatic, paced via onStep) → play → end.
 * `reveal` turns one card per STEP_PHASE and moves on once two are face up;
 * `play` → `end` fires only when a third card reaches the discard, which
 * the tests arrange by hand to exercise ADVANCE_PHASE.
 */
function makePacedRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Paced Game",
      slug: "paced-game",
      version: "1.0.0",
      author: "test",
      players: { min: 2, max: 4 },
    },
    deck: { preset: "standard_52", copies: 1, cardValues: { A: { kind: "fixed", value: 1 } } },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    phases: [
      {
        name: "deal",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "reveal", when: "all_hands_dealt" }],
        onEnter: ["shuffle(draw_pile)", "deal(draw_pile, hand, 2)"],
      },
      {
        name: "reveal",
        kind: "automatic",
        actions: [],
        transitions: [{ to: "play", when: "card_count(discard) >= 2" }],
        onStep: ["move_top(draw_pile, discard, 1)"],
      },
      {
        name: "play",
        kind: "turn_based",
        actions: [{ name: "pass", label: "Pass", effect: ["end_turn()"] }],
        transitions: [{ to: "end", when: "card_count(discard) >= 3" }],
      },
      {
        name: "end",
        kind: "turn_based",
        actions: [{ name: "pass", label: "Pass", effect: ["end_turn()"] }],
        transitions: [],
      },
    ],
    scoring: { method: "card_count(hand)", winCondition: "false" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

function withPlayers(state: HostGameState, count: number): HostGameState {
  const players: HostGameState["players"] = {};
  for (let i = 1; i <= count; i++) {
    players[`p${i}`] = { id: `p${i}`, name: `Player ${i}`, connected: true, isHost: i === 1 };
  }
  return { ...state, players };
}

function startGame(seed = 42, ruleset = makePacedRuleset()): HostGameState {
  let state = createHostInitialState();
  state = hostReducer(state, { type: "SELECT_RULESET", ruleset });
  state = withPlayers(state, 2);
  return hostReducer(state, { type: "START_GAME", seed });
}

function engineOf(state: HostGameState): CardGameState {
  if (!state.engineState) throw new Error("expected an engine state");
  return state.engineState;
}

/** Steps the paced `reveal` phase until play begins. */
function stepToPlay(state: HostGameState): HostGameState {
  let current = state;
  for (let i = 0; i < 5 && engineOf(current).currentPhase === "reveal"; i++) {
    current = hostReducer(current, { type: "STEP_PHASE" });
  }
  return current;
}

/** Moves the top draw-pile card onto the discard, bypassing the rules. */
function discardOneByHand(state: HostGameState): HostGameState {
  const engine = engineOf(state);
  const [top, ...rest] = engine.zones.draw_pile!.cards;
  if (!top) throw new Error("draw pile is empty");
  return {
    ...state,
    engineState: {
      ...engine,
      zones: {
        ...engine.zones,
        draw_pile: { ...engine.zones.draw_pile!, cards: rest },
        discard: { ...engine.zones.discard!, cards: [...engine.zones.discard!.cards, top] },
      },
    },
  };
}

// ─── deriveStatus ──────────────────────────────────────────────────

describe("deriveStatus", () => {
  const ruleset = makePacedRuleset();

  it("reports the picker screen", () => {
    expect(deriveStatus({ tag: "ruleset_picker" }, null)).toBe("ruleset_picker");
  });

  it("reports the lobby screen", () => {
    expect(deriveStatus({ tag: "lobby", ruleset }, null)).toBe("lobby");
  });

  it("prefixes the engine status on the game table", () => {
    const engineState = engineOf(startGame());
    const screen: HostScreen = { tag: "game_table", ruleset };

    expect(deriveStatus(screen, engineState)).toBe("game:in_progress");
    expect(
      deriveStatus(screen, {
        ...engineState,
        status: { kind: "finished", finishedAt: 0, winnerId: null },
      }),
    ).toBe("game:finished");
  });

  it("reports an unknown game when the table has no engine state", () => {
    expect(deriveStatus({ tag: "game_table", ruleset }, null)).toBe("game:unknown");
  });
});

// ─── START_GAME ────────────────────────────────────────────────────

describe("START_GAME", () => {
  it("deals identically for the same seed, even with other games in between", () => {
    const ruleset = makePacedRuleset();
    const first = engineOf(startGame(7, ruleset));
    startGame(1234, ruleset); // shares the cached engine — must not disturb the next game
    const second = engineOf(startGame(7, ruleset));

    expect(second.zones).toEqual(first.zones);
    expect(second.rngState).toBe(first.rngState);
  });

  it("deals differently for different seeds", () => {
    const a = engineOf(startGame(1));
    const b = engineOf(startGame(2));

    expect(b.zones["hand:0"]!.cards).not.toEqual(a.zones["hand:0"]!.cards);
  });

  it("stays in the lobby when there are too few players for the ruleset", () => {
    let state = createHostInitialState();
    state = hostReducer(state, { type: "SELECT_RULESET", ruleset: makePacedRuleset() });
    state = withPlayers(state, 1);

    expect(hostReducer(state, { type: "START_GAME", seed: 1 })).toBe(state);
  });

  it("issues a fresh session id per game", () => {
    expect(engineOf(startGame(5)).sessionId).not.toBe(engineOf(startGame(5)).sessionId);
  });
});

// ─── STEP_PHASE ────────────────────────────────────────────────────

describe("STEP_PHASE", () => {
  it("runs one onStep per dispatch, then advances once the transition fires", () => {
    const started = startGame();
    expect(engineOf(started).currentPhase).toBe("reveal");
    expect(engineOf(started).zones.discard!.cards).toHaveLength(0);

    const once = hostReducer(started, { type: "STEP_PHASE" });
    expect(engineOf(once).currentPhase).toBe("reveal");
    expect(engineOf(once).zones.discard!.cards).toHaveLength(1);
    expect(once.status).toBe("game:in_progress");

    const twice = hostReducer(once, { type: "STEP_PHASE" });
    expect(engineOf(twice).currentPhase).toBe("play");
    expect(engineOf(twice).zones.discard!.cards).toHaveLength(2);
  });

  it("leaves host state untouched outside a paced phase", () => {
    const inPlay = stepToPlay(startGame());
    expect(engineOf(inPlay).currentPhase).toBe("play");

    expect(hostReducer(inPlay, { type: "STEP_PHASE" })).toBe(inPlay);
  });

  it("is ignored away from the game table", () => {
    const lobby = hostReducer(createHostInitialState(), {
      type: "SELECT_RULESET",
      ruleset: makePacedRuleset(),
    });

    expect(hostReducer(lobby, { type: "STEP_PHASE" })).toBe(lobby);
  });
});

// ─── ADVANCE_PHASE ─────────────────────────────────────────────────

describe("ADVANCE_PHASE", () => {
  it("follows a transition whose condition has become true", () => {
    const ready = discardOneByHand(stepToPlay(startGame()));
    expect(engineOf(ready).currentPhase).toBe("play");

    const next = hostReducer(ready, { type: "ADVANCE_PHASE" });

    expect(engineOf(next).currentPhase).toBe("end");
    expect(engineOf(next).turnsTakenThisPhase).toBe(0);
    expect(engineOf(next).version).toBe(engineOf(ready).version + 1);
  });

  it("leaves host state untouched when no transition is available", () => {
    const inPlay = stepToPlay(startGame());

    expect(hostReducer(inPlay, { type: "ADVANCE_PHASE" })).toBe(inPlay);
  });

  it("is ignored away from the game table", () => {
    const picker = createHostInitialState();
    expect(hostReducer(picker, { type: "ADVANCE_PHASE" })).toBe(picker);
  });
});

// ─── RESET_ROUND ───────────────────────────────────────────────────

describe("RESET_ROUND", () => {
  it("restarts from the first phase, re-running automatic phases", () => {
    const inPlay = stepToPlay(startGame());
    const before = engineOf(inPlay);

    const reset = hostReducer(inPlay, { type: "RESET_ROUND" });
    const after = engineOf(reset);

    // deal ran again (two more cards each); nothing collected the discard,
    // so reveal's transition holds immediately and play resumes
    expect(after.currentPhase).toBe("play");
    expect(after.turnNumber).toBe(before.turnNumber + 1);
    expect(after.currentPlayerIndex).toBe(0);
    expect(after.zones["hand:0"]!.cards).toHaveLength(4);
    expect(reset.status).toBe("game:in_progress");
  });

  it("is ignored away from the game table", () => {
    const picker = createHostInitialState();
    expect(hostReducer(picker, { type: "RESET_ROUND" })).toBe(picker);
  });
});

// ─── BACK_TO_PICKER ────────────────────────────────────────────────

describe("BACK_TO_PICKER", () => {
  it("abandons an active game and returns to the picker", () => {
    const next = hostReducer(startGame(), { type: "BACK_TO_PICKER" });

    expect(next.screen).toEqual({ tag: "ruleset_picker" });
    expect(next.status).toBe("ruleset_picker");
    expect(next.engineState).toBeNull();
  });

  it("returns from the lobby, keeping connected players", () => {
    let lobby = hostReducer(createHostInitialState(), {
      type: "SELECT_RULESET",
      ruleset: makePacedRuleset(),
    });
    lobby = withPlayers(lobby, 2);

    const next = hostReducer(lobby, { type: "BACK_TO_PICKER" });

    expect(next.screen.tag).toBe("ruleset_picker");
    expect(Object.keys(next.players)).toEqual(["p1", "p2"]);
  });
});

// ─── GAME_ACTION guards ────────────────────────────────────────────

describe("GAME_ACTION from clients", () => {
  const blocked: readonly CardGameAction[] = [
    { kind: "join", playerId: "intruder" as PlayerId, name: "Intruder" },
    { kind: "leave", playerId: "p2" as PlayerId },
    { kind: "start_game" },
  ];

  for (const action of blocked) {
    it(`ignores client-sent ${action.kind}`, () => {
      const state = stepToPlay(startGame());
      expect(hostReducer(state, { type: "GAME_ACTION", action })).toBe(state);
    });
  }

  it("records the engine's rejection reason for an illegal move", () => {
    const state = stepToPlay(startGame());
    const notCurrent = engineOf(state).players[1]!.id;

    const next = hostReducer(state, {
      type: "GAME_ACTION",
      action: { kind: "declare", playerId: notCurrent, declaration: "pass" },
    });

    expect(next.engineState).toBe(state.engineState);
    expect(next.actionError?.playerId).toBe(notCurrent);
    expect(next.actionError?.reason).toMatch(/turn/i);
  });
});
