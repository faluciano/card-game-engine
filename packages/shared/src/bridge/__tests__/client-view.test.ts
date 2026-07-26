import { describe, it, expect } from "vitest";
import { createHostInitialState, hostReducer } from "../host-reducer";
import { createHostClientView } from "../client-view";
import type { HostGameState } from "../host-state";
import type { CardGameRuleset } from "../../types/index";

/**
 * These tests are the guarantee behind server-side projection: a player's
 * device must never receive another player's cards. Filtering in the
 * controller — what this replaced — only hid them from the UI, leaving them in
 * memory for anyone who opened devtools.
 */

function makeTestRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Test Game",
      slug: "test-game",
      version: "1.0.0",
      author: "test",
      players: { min: 2, max: 4 },
    },
    deck: { preset: "standard_52", copies: 1, cardValues: { A: { kind: "fixed", value: 1 } } },
    zones: [
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      { name: "discard", visibility: { kind: "public" }, owners: [] },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    phases: [
      {
        name: "play",
        kind: "turn_based",
        actions: [
          { name: "draw", label: "Draw", effect: ["draw(draw_pile, hand, 1)"] },
          { name: "end_turn", label: "End Turn", effect: ["end_turn()"] },
        ],
        transitions: [],
      },
    ],
    scoring: { method: "card_count(hand)", winCondition: "highest_wins" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

function makeStartedGameState(): HostGameState {
  let state = createHostInitialState();
  state = hostReducer(state, { type: "SELECT_RULESET", ruleset: makeTestRuleset() });
  state = {
    ...state,
    players: {
      p1: { id: "p1", name: "Alice", connected: true, isHost: true },
      p2: { id: "p2", name: "Bob", connected: true, isHost: false },
    },
  };
  state = hostReducer(state, { type: "START_GAME" });

  // The test ruleset has no deal step, so place known cards by hand — an empty
  // hand would make these assertions pass without proving anything.
  const engineState = state.engineState;
  if (!engineState) throw new Error("expected a started game");
  return {
    ...state,
    engineState: {
      ...engineState,
      zones: {
        ...engineState.zones,
        "hand:0": {
          ...engineState.zones["hand:0"],
          cards: [
            { id: "ALICE-CARD-1", rank: "A", suit: "spades", faceUp: false },
            { id: "ALICE-CARD-2", rank: "K", suit: "hearts", faceUp: false },
          ],
        },
        "hand:1": {
          ...engineState.zones["hand:1"],
          cards: [
            { id: "BOB-SECRET-1", rank: "Q", suit: "clubs", faceUp: false },
            { id: "BOB-SECRET-2", rank: "J", suit: "diamonds", faceUp: false },
          ],
        },
      },
    },
  } as HostGameState;
}

/** Card ids in a player's hand, read from the authoritative state. */
function handOf(state: HostGameState, playerIndex: number): string[] {
  const zone = state.engineState?.zones[`hand:${playerIndex}`];
  return (zone?.cards ?? []).map((c) => c.id);
}

describe("createHostClientView", () => {
  it("never puts another player's cards on the wire", () => {
    const state = makeStartedGameState();
    const bobsCards = handOf(state, 1);
    expect(bobsCards.length).toBeGreaterThan(0);

    const alicesView = JSON.stringify(createHostClientView(state, "p1"));

    // The serialized payload is exactly what the transport sends.
    for (const cardId of bobsCards) {
      expect(alicesView).not.toContain(cardId);
    }
  });

  it("still gives a player their own cards", () => {
    const state = makeStartedGameState();
    const alicesCards = handOf(state, 0);

    const view = createHostClientView(state, "p1");
    const serialized = JSON.stringify(view);

    expect(alicesCards.length).toBeGreaterThan(0);
    for (const cardId of alicesCards) {
      expect(serialized).toContain(cardId);
    }
  });

  it("omits the engine state entirely", () => {
    const state = makeStartedGameState();
    const view = createHostClientView(state, "p1") as Record<string, unknown>;

    // The controller works from `playerView`; raw engine state is the thing
    // that leaked, so it must not survive projection under any key.
    expect(view.engineState).toBeUndefined();
    expect(view.playerView).not.toBeNull();
  });

  it("carries affordances, which a projected client cannot compute", () => {
    const state = makeStartedGameState();
    const view = createHostClientView(state, "p1");

    // getValidActions needs the full CardGameState, so the host supplies the
    // answer rather than the inputs.
    expect(Array.isArray(view.validActions)).toBe(true);
    expect(Array.isArray(view.playableCardIds)).toBe(true);
  });

  it("summarises the ruleset instead of shipping it", () => {
    const state = makeStartedGameState();
    const view = createHostClientView(state, "p1");
    const serialized = JSON.stringify(view);

    expect(view.screen.tag).toBe("game_table");
    if (view.screen.tag !== "ruleset_picker") {
      expect(view.screen.ruleset.slug).toBe("test-game");
    }
    // The full ruleset (phases, effects) is the bulk of host state and no
    // controller reads it.
    expect(serialized).not.toContain("end_turn()");
    expect(serialized).not.toContain("draw_pile, hand");
  });

  it("gives an unknown player no engine view at all", () => {
    const state = makeStartedGameState();
    const view = createHostClientView(state, "not-a-player");

    expect(view.playerView).toBeNull();
    expect(view.validActions).toEqual([]);
    expect(view.playableCardIds).toEqual([]);
  });

  it("projects a lobby state before any game exists", () => {
    let state = createHostInitialState();
    state = hostReducer(state, {
      type: "SELECT_RULESET",
      ruleset: makeTestRuleset(),
    });

    const view = createHostClientView(state, "p1");
    expect(view.screen.tag).toBe("lobby");
    expect(view.playerView).toBeNull();
  });
});
