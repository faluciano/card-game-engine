import { describe, it, expect } from "vitest";
import {
  createHostInitialState,
  hostReducer,
} from "../host-reducer";
import type { HostAction, HostGameState } from "../host-state";
import type { CardGameRuleset, CardGameState } from "../../types/index";

// ─── Fixtures ──────────────────────────────────────────────────────

/** Minimal valid CardGameRuleset that satisfies the full schema. */
function makeTestRuleset(overrides?: Partial<CardGameRuleset["meta"]>): CardGameRuleset {
  return {
    meta: {
      name: "Test Game",
      slug: "test-game",
      version: "1.0.0",
      author: "test",
      players: { min: 2, max: 4 },
      ...overrides,
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
    ],
    roles: [
      { name: "player", isHuman: true, count: "per_player" },
    ],
    phases: [
      {
        name: "play",
        kind: "turn_based",
        actions: [{ name: "end_turn", label: "End Turn", effect: ["end_turn()"] }],
        transitions: [],
      },
    ],
    scoring: {
      method: "card_count(hand)",
      winCondition: "highest_wins",
    },
    visibility: [
      { zone: "hand", visibility: { kind: "owner_only" } },
    ],
    ui: {
      layout: "semicircle",
      tableColor: "felt_green",
    },
  };
}

/** Creates a game_table state with active engineState for isolation tests. */
function makeGameTableState(): HostGameState {
  const ruleset = makeTestRuleset();
  // Minimal engine state stub — only needs to be non-null for the guard check
  const stubEngineState = {
    sessionId: "test-session-id",
    status: { kind: "in_progress" as const },
    ruleset,
    players: [],
    zones: [],
    currentPhaseIndex: 0,
    currentPlayerIndex: 0,
    round: 1,
    variables: {},
    rngState: 0,
    turnHistory: [],
  } as unknown as CardGameState;

  return {
    status: "game:in_progress",
    players: { p1: { name: "Alice", connected: true, color: "#fff" } },
    screen: { tag: "game_table", ruleset },
    engineState: stubEngineState,
    installedSlugs: [],
    pendingInstall: null,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("catalog actions (host reducer)", () => {
  // ══════════════════════════════════════════════════════════════════
  // ── createHostInitialState ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("createHostInitialState", () => {
    it("includes installedSlugs as empty array", () => {
      const state = createHostInitialState();
      expect(state.installedSlugs).toEqual([]);
    });

    it("includes pendingInstall as null", () => {
      const state = createHostInitialState();
      expect(state.pendingInstall).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── INSTALL_RULESET ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("INSTALL_RULESET", () => {
    it("sets pendingInstall with the provided ruleset and slug", () => {
      const state = createHostInitialState();
      const ruleset = makeTestRuleset();
      const action: HostAction = {
        type: "INSTALL_RULESET",
        ruleset,
        slug: "test-game",
      };

      const next = hostReducer(state, action);

      expect(next.pendingInstall).toEqual({
        ruleset,
        slug: "test-game",
      });
    });

    it("does NOT change installedSlugs", () => {
      const state = createHostInitialState();
      const ruleset = makeTestRuleset();
      const action: HostAction = {
        type: "INSTALL_RULESET",
        ruleset,
        slug: "test-game",
      };

      const next = hostReducer(state, action);

      expect(next.installedSlugs).toEqual(state.installedSlugs);
    });

    it("does NOT change screen, status, or engineState", () => {
      const state = createHostInitialState();
      const ruleset = makeTestRuleset();
      const action: HostAction = {
        type: "INSTALL_RULESET",
        ruleset,
        slug: "test-game",
      };

      const next = hostReducer(state, action);

      expect(next.screen).toEqual(state.screen);
      expect(next.status).toBe(state.status);
      expect(next.engineState).toBe(state.engineState);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── SET_INSTALLED_SLUGS ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("SET_INSTALLED_SLUGS", () => {
    it("updates installedSlugs from the action payload", () => {
      const state = createHostInitialState();
      const action: HostAction = {
        type: "SET_INSTALLED_SLUGS",
        slugs: ["blackjack", "poker"],
      };

      const next = hostReducer(state, action);

      expect(next.installedSlugs).toEqual(["blackjack", "poker"]);
    });

    it("clears pendingInstall to null even if it was previously set", () => {
      // Arrange: state with an active pendingInstall
      const ruleset = makeTestRuleset();
      const stateWithPending: HostGameState = {
        ...createHostInitialState(),
        pendingInstall: { ruleset, slug: "test-game" },
      };

      const action: HostAction = {
        type: "SET_INSTALLED_SLUGS",
        slugs: ["test-game"],
      };

      const next = hostReducer(stateWithPending, action);

      expect(next.pendingInstall).toBeNull();
    });

    it("does NOT change screen, status, or engineState", () => {
      const state = createHostInitialState();
      const action: HostAction = {
        type: "SET_INSTALLED_SLUGS",
        slugs: ["blackjack"],
      };

      const next = hostReducer(state, action);

      expect(next.screen).toEqual(state.screen);
      expect(next.status).toBe(state.status);
      expect(next.engineState).toBe(state.engineState);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Round-trip flow ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("round-trip flow", () => {
    it("INSTALL_RULESET → SET_INSTALLED_SLUGS transitions correctly", () => {
      const ruleset = makeTestRuleset();

      // Start at initial state
      let state = createHostInitialState();
      expect(state.pendingInstall).toBeNull();
      expect(state.installedSlugs).toEqual([]);

      // Step 1: dispatch INSTALL_RULESET
      state = hostReducer(state, {
        type: "INSTALL_RULESET",
        ruleset,
        slug: "test-game",
      });
      expect(state.pendingInstall).toEqual({ ruleset, slug: "test-game" });
      expect(state.installedSlugs).toEqual([]);

      // Step 2: dispatch SET_INSTALLED_SLUGS (host hook completed I/O)
      state = hostReducer(state, {
        type: "SET_INSTALLED_SLUGS",
        slugs: ["test-game"],
      });
      expect(state.installedSlugs).toEqual(["test-game"]);
      expect(state.pendingInstall).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── SET_INSTALLED_SLUGS replaces (not appends) ───────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("SET_INSTALLED_SLUGS replaces (not appends)", () => {
    it("replaces existing installedSlugs entirely", () => {
      // Arrange: state that already has slugs installed
      const stateWithSlugs: HostGameState = {
        ...createHostInitialState(),
        installedSlugs: ["a", "b"],
      };

      const action: HostAction = {
        type: "SET_INSTALLED_SLUGS",
        slugs: ["c"],
      };

      const next = hostReducer(stateWithSlugs, action);

      expect(next.installedSlugs).toEqual(["c"]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── INSTALL_RULESET during active game ───────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("INSTALL_RULESET during active game", () => {
    it("sets pendingInstall without breaking screen or engineState", () => {
      const gameState = makeGameTableState();
      const newRuleset = makeTestRuleset({ slug: "new-game", name: "New Game" });

      const action: HostAction = {
        type: "INSTALL_RULESET",
        ruleset: newRuleset,
        slug: "new-game",
      };

      const next = hostReducer(gameState, action);

      // pendingInstall is set
      expect(next.pendingInstall).toEqual({
        ruleset: newRuleset,
        slug: "new-game",
      });

      // Screen and engineState are completely untouched
      expect(next.screen).toEqual(gameState.screen);
      expect(next.engineState).toBe(gameState.engineState);
      expect(next.status).toBe(gameState.status);
      expect(next.players).toEqual(gameState.players);
    });
  });
});
