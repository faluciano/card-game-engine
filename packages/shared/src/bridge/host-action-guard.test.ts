import { describe, it, expect } from "vitest";
import { authorizeHostAction, isHostActionRejection } from "./host-action-guard";
import { createHostInitialState, hostReducer } from "./host-reducer";
import type { HostAction, HostGameState } from "./host-state";
import type { CardGameRuleset, PlayerId } from "../types/index";

// ─── Fixtures ──────────────────────────────────────────────────────

/** Two-player game where "draw" and "end_turn" are always valid for the current player. */
function makeTestRuleset(): CardGameRuleset {
  return {
    meta: {
      name: "Guard Test",
      slug: "guard-test",
      version: "1.0.0",
      author: "test",
      players: { min: 2, max: 4 },
    },
    deck: { preset: "standard_52", copies: 1, cardValues: {} },
    zones: [
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
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
    scoring: { method: "card_count(hand)", winCondition: "false" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

/** A started game: p1 (Alice) is the current player, p2 (Bob) waits. */
function makeStartedGameState(): HostGameState {
  let state = hostReducer(createHostInitialState(), {
    type: "SELECT_RULESET",
    ruleset: makeTestRuleset(),
  });
  state = {
    ...state,
    players: {
      p1: { id: "p1", name: "Alice", connected: true, isHost: false },
      p2: { id: "p2", name: "Bob", connected: true, isHost: false },
    },
  };
  return hostReducer(state, { type: "START_GAME" });
}

/** An action as CouchKit delivers it from a phone: stamped with the sender. */
function fromPhone(action: HostAction, senderId: string): HostAction {
  return { ...action, playerId: senderId } as unknown as HostAction;
}

function declare(playerId: string, declaration: string): HostAction {
  return {
    type: "GAME_ACTION",
    action: { kind: "declare", playerId: playerId as PlayerId, declaration },
  };
}

// ─── authorizeHostAction ───────────────────────────────────────────

describe("authorizeHostAction", () => {
  const state = createHostInitialState();

  describe("host dispatches (no sender)", () => {
    it("passes every action through unchanged", () => {
      const actions: HostAction[] = [
        { type: "START_GAME", seed: 7 },
        { type: "RESET_ROUND" },
        { type: "STEP_PHASE" },
        { type: "BACK_TO_PICKER" },
        { type: "SET_INSTALLED_SLUGS", slugs: [] },
      ];
      for (const action of actions) {
        expect(authorizeHostAction(action, undefined, state)).toBe(action);
      }
    });
  });

  describe("phone actions", () => {
    it.each([
      ["START_GAME", { type: "START_GAME", seed: 7 }],
      ["BACK_TO_PICKER", { type: "BACK_TO_PICKER" }],
      ["RESET_ROUND", { type: "RESET_ROUND" }],
      ["ADVANCE_PHASE", { type: "ADVANCE_PHASE" }],
      ["STEP_PHASE", { type: "STEP_PHASE" }],
      ["SET_INSTALLED_SLUGS", { type: "SET_INSTALLED_SLUGS", slugs: [] }],
    ] as const)("rejects the host-only %s", (type, action) => {
      const result = authorizeHostAction(action as HostAction, "p1", state);
      expect(result).toEqual({ reject: `Players cannot send ${type}; only the host can` });
    });

    it("rejects unknown action types", () => {
      const result = authorizeHostAction({ type: "HACK" } as unknown as HostAction, "p1", state);
      expect(isHostActionRejection(result)).toBe(true);
    });

    it("allows the library actions", () => {
      const ruleset = makeTestRuleset();
      const actions: HostAction[] = [
        { type: "INSTALL_RULESET", ruleset, slug: "guard-test" },
        { type: "UNINSTALL_RULESET", slug: "guard-test" },
        { type: "SELECT_RULESET", ruleset },
      ];
      for (const action of actions) {
        expect(authorizeHostAction(action, "p1", state)).toBe(action);
      }
    });

    it("pins a GAME_ACTION to the sender's player", () => {
      const result = authorizeHostAction(declare("p2", "draw"), "p1", state);
      expect(result).toEqual(declare("p1", "draw"));
    });

    it("pins play_card moves to the sender's player", () => {
      const action: HostAction = {
        type: "GAME_ACTION",
        action: {
          kind: "play_card",
          playerId: "p2" as PlayerId,
          cardId: "c1" as never,
          fromZone: "hand:1",
          toZone: "discard",
        },
      };
      const result = authorizeHostAction(action, "p1", state);
      expect(result).toMatchObject({ action: { kind: "play_card", playerId: "p1" } });
    });

    it.each(["advance_phase", "step_phase", "reset_round", "start_game"] as const)(
      "rejects the engine action %s inside GAME_ACTION",
      (kind) => {
        const action = { type: "GAME_ACTION", action: { kind } } as HostAction;
        expect(authorizeHostAction(action, "p1", state)).toEqual({
          reject: `Players cannot send the engine action ${kind}`,
        });
      },
    );
  });
});

// ─── Runtime integration ───────────────────────────────────────────

/**
 * What CouchKit's runtime does with a phone action when the host passes
 * `authorizeAction: authorizeHostAction`: authorize it, then reduce the
 * result stamped with the sender. A rejection leaves the state alone.
 */
function receiveFromPhone(state: HostGameState, action: HostAction, senderId: string) {
  const authorized = authorizeHostAction(fromPhone(action, senderId), senderId, state);
  if (isHostActionRejection(authorized)) return { state, rejection: authorized.reject };
  return { state: hostReducer(state, fromPhone(authorized, senderId)), rejection: null };
}

describe("authorizeHostAction as the runtime's authorizeAction", () => {
  it("lets a phone act for its own player", () => {
    const { state } = receiveFromPhone(makeStartedGameState(), declare("p1", "draw"), "p1");
    expect(state.engineState!.zones["hand:0"]!.cards).toHaveLength(1);
  });

  it("stops a phone from acting as another player", () => {
    // Bob claims to be Alice, whose turn it is.
    const { state } = receiveFromPhone(makeStartedGameState(), declare("p1", "draw"), "p2");
    expect(state.engineState!.zones["hand:0"]!.cards).toHaveLength(0);
    expect(state.engineState!.zones["hand:1"]!.cards).toHaveLength(0);
    expect(state.actionError?.playerId).toBe("p2");
  });

  it("refuses a phone leaving the table mid-game", () => {
    const before = makeStartedGameState();
    const { state, rejection } = receiveFromPhone(before, { type: "BACK_TO_PICKER" }, "p2");
    expect(state).toBe(before);
    expect(rejection).toBe("Players cannot send BACK_TO_PICKER; only the host can");
  });

  it("refuses a phone starting the game with a chosen seed", () => {
    let lobby = hostReducer(createHostInitialState(), {
      type: "SELECT_RULESET",
      ruleset: makeTestRuleset(),
    });
    lobby = {
      ...lobby,
      players: {
        p1: { id: "p1", name: "Alice", connected: true, isHost: false },
        p2: { id: "p2", name: "Bob", connected: true, isHost: false },
      },
    };
    const { state, rejection } = receiveFromPhone(lobby, { type: "START_GAME", seed: 1 }, "p1");
    expect(state).toBe(lobby);
    expect(rejection).not.toBeNull();
  });

  it("leaves the host's own dispatches to the reducer", () => {
    const state = makeStartedGameState();
    expect(hostReducer(state, { type: "BACK_TO_PICKER" }).screen.tag).toBe("ruleset_picker");
  });
});
