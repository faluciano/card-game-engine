import { describe, it, expect } from "vitest";
import { createHostInitialState, hostReducer } from "../host-reducer";
import type { HostAction, HostGameState } from "../host-state";
import type { CardGameRuleset, PlayerId } from "../../types/index";

// ─── Fixtures ──────────────────────────────────────────────────────

/**
 * Minimal valid CardGameRuleset with a turn_based "play" phase.
 * The "end_turn" action has no condition, so it's always valid for
 * the current player. This lets us test valid vs. rejected actions.
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
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: {
        A: { kind: "fixed", value: 1 },
      },
    },
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
          {
            name: "draw",
            label: "Draw",
            effect: ["draw(draw_pile, hand, 1)"],
          },
          {
            name: "end_turn",
            label: "End Turn",
            effect: ["end_turn()"],
          },
        ],
        transitions: [],
      },
    ],
    scoring: {
      method: "card_count(hand)",
      winCondition: "highest_wins",
    },
    ui: {
      layout: "semicircle",
      tableColor: "felt_green",
    },
  };
}

/**
 * Creates a fully started game with two players via the host reducer flow:
 * createHostInitialState -> SELECT_RULESET -> add players -> START_GAME
 */
function makeStartedGameState(): HostGameState {
  const ruleset = makeTestRuleset();

  // 1. Initial state
  let state = createHostInitialState();

  // 2. Select ruleset -> lobby
  state = hostReducer(state, { type: "SELECT_RULESET", ruleset });

  // 3. Add two players to the CouchKit players record
  state = {
    ...state,
    players: {
      p1: { id: "p1", name: "Alice", connected: true, isHost: true },
      p2: { id: "p2", name: "Bob", connected: true, isHost: false },
    },
  };

  // 4. Start the game
  state = hostReducer(state, { type: "START_GAME" });

  return state;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("action error feedback (host reducer)", () => {
  // ══════════════════════════════════════════════════════════════════
  // ── Initial state ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("initial state", () => {
    it("actionError is undefined on fresh host state", () => {
      const state = createHostInitialState();
      expect(state.actionError).toBeUndefined();
    });

    it("actionError is not present after starting a game", () => {
      const state = makeStartedGameState();
      // After START_GAME, actionError should still be undefined (never set)
      expect(state.actionError).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Rejected actions set actionError ─────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("rejected actions set actionError", () => {
    it("sets actionError when a player acts out of turn", () => {
      const state = makeStartedGameState();
      expect(state.screen.tag).toBe("game_table");
      expect(state.engineState).not.toBeNull();

      // Player 0 (p1) is the current player. Sending an action from p2 should be rejected.
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;

      const action: HostAction = {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: wrongPlayerId,
          declaration: "end_turn",
        },
      };

      const next = hostReducer(state, action);

      expect(next.actionError).toBeDefined();
      expect(next.actionError).not.toBeNull();
      expect(next.actionError!.playerId).toBe(wrongPlayerId);
      expect(next.actionError!.reason).toBeTruthy();
      expect(typeof next.actionError!.reason).toBe("string");
      expect(next.actionError!.reason.length).toBeGreaterThan(0);
      expect(typeof next.actionError!.timestamp).toBe("number");
    });

    it("sets actionError when action references nonexistent player", () => {
      const state = makeStartedGameState();

      const action: HostAction = {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: "nonexistent-player" as PlayerId,
          declaration: "end_turn",
        },
      };

      const next = hostReducer(state, action);

      expect(next.actionError).toBeDefined();
      expect(next.actionError!.playerId).toBe("nonexistent-player");
      expect(next.actionError!.reason).toBeTruthy();
    });

    it("sets actionError with correct playerId and non-empty reason", () => {
      const state = makeStartedGameState();
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;

      const action: HostAction = {
        type: "GAME_ACTION",
        action: {
          kind: "end_turn",
          playerId: wrongPlayerId,
        },
      };

      const next = hostReducer(state, action);

      expect(next.actionError).not.toBeNull();
      expect(next.actionError!.playerId).toBe(wrongPlayerId);
      expect(next.actionError!.reason.length).toBeGreaterThan(0);
      expect(next.actionError!.timestamp).toBeGreaterThan(0);
    });

    it("does not change engineState when action is rejected", () => {
      const state = makeStartedGameState();
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;

      const action: HostAction = {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: wrongPlayerId,
          declaration: "end_turn",
        },
      };

      const next = hostReducer(state, action);

      // Engine state should remain unchanged
      expect(next.engineState).toBe(state.engineState);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Successful actions clear actionError ─────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("successful actions clear actionError", () => {
    it("clears actionError on successful GAME_ACTION", () => {
      let state = makeStartedGameState();

      // First, create an error by sending action from wrong player
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;
      const correctPlayerId = state.engineState!.players[currentPlayerIndex]!.id;

      state = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: wrongPlayerId,
          declaration: "end_turn",
        },
      });

      // Verify error was set
      expect(state.actionError).not.toBeNull();

      // Now send a valid action from the correct player
      const next = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: correctPlayerId,
          declaration: "end_turn",
        },
      });

      // Error should be cleared
      expect(next.actionError).toBeNull();
    });

    it("clears actionError even when error was from a different player", () => {
      let state = makeStartedGameState();
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;
      const correctPlayerId = state.engineState!.players[currentPlayerIndex]!.id;

      // Create error from wrong player
      state = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "end_turn",
          playerId: wrongPlayerId,
        },
      });
      expect(state.actionError).not.toBeNull();
      expect(state.actionError!.playerId).toBe(wrongPlayerId);

      // Successful action from the correct player clears error from any player
      const next = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: correctPlayerId,
          declaration: "end_turn",
        },
      });

      expect(next.actionError).toBeNull();
    });

    it("sets actionError to null (not undefined) on success", () => {
      let state = makeStartedGameState();
      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const correctPlayerId = state.engineState!.players[currentPlayerIndex]!.id;

      // Send a valid action on a fresh state (actionError was undefined)
      const next = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: correctPlayerId,
          declaration: "end_turn",
        },
      });

      // actionError should be explicitly null, not undefined
      expect(next.actionError).toBeNull();
      expect("actionError" in next).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── actionError timestamp ────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("actionError timestamp", () => {
    it("includes a recent timestamp on rejection", () => {
      const state = makeStartedGameState();
      const before = Date.now();

      const currentPlayerIndex = state.engineState!.currentPlayerIndex;
      const wrongPlayerId = state.engineState!.players[currentPlayerIndex === 0 ? 1 : 0]!.id;

      const next = hostReducer(state, {
        type: "GAME_ACTION",
        action: {
          kind: "declare",
          playerId: wrongPlayerId,
          declaration: "end_turn",
        },
      });

      const after = Date.now();

      expect(next.actionError!.timestamp).toBeGreaterThanOrEqual(before);
      expect(next.actionError!.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
