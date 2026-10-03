// ─── Schema Cross-Reference Tests ──────────────────────────────────
// Verifies the superRefine pass that cross-checks names between ruleset
// sections and parse-checks every expression at load time.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RulesetParseError } from "../engine/interpreter";
import { loadRuleset, safeParseRuleset } from "./validation";

// ─── Helpers ───────────────────────────────────────────────────────

interface TestPhase {
  readonly name: string;
  readonly kind: "automatic" | "turn_based" | "all_players";
  readonly actions: readonly {
    readonly name: string;
    readonly label: string;
    readonly condition?: string;
    readonly effect: readonly string[];
  }[];
  readonly transitions: readonly { readonly to: string; readonly when: string }[];
  readonly onEnter?: readonly string[];
  readonly autoEndTurnCondition?: string;
}

const PLAY_PHASE: TestPhase = {
  name: "play",
  kind: "turn_based",
  actions: [{ name: "pass", label: "Pass", effect: ["end_turn()"] }],
  transitions: [{ to: "done", when: "all_players_done" }],
};

const DONE_PHASE: TestPhase = {
  name: "done",
  kind: "automatic",
  actions: [],
  transitions: [],
};

/** Returns a minimal ruleset that passes every cross-reference check. */
function makeRuleset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: {
      name: "Test Game",
      slug: "test-game",
      version: "1.0.0",
      author: "test-author",
      players: { min: 1, max: 4 },
    },
    deck: { preset: "standard_52", copies: 1, cardValues: { A: 1 } },
    zones: [
      { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
      { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    phases: [PLAY_PHASE, DONE_PHASE],
    scoring: { method: "card_count(current_player.hand)", winCondition: "my_score > 0" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
    ...overrides,
  };
}

/** Parses `raw` and returns the issues as "path: message" strings. */
function issuesOf(raw: unknown): string[] {
  const result = safeParseRuleset(raw);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
}

// ─── Baseline ──────────────────────────────────────────────────────

describe("cross-reference checks", () => {
  it("accepts a ruleset whose names and expressions are consistent", () => {
    expect(issuesOf(makeRuleset())).toEqual([]);
  });

  it("accepts every bundled ruleset in rulesets/", () => {
    const dir = join(import.meta.dirname, "..", "..", "..", "..", "rulesets");
    const files = readdirSync(dir).filter((f) => f.endsWith(".cardgame.json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      expect({ file, issues: issuesOf(raw) }).toEqual({ file, issues: [] });
    }
  });

  // ─── Phase names ─────────────────────────────────────────────────

  describe("phase transition targets", () => {
    it("rejects a transition to an undeclared phase", () => {
      const phases = [
        { ...PLAY_PHASE, transitions: [{ to: "nowhere", when: "true" }] },
        DONE_PHASE,
      ];
      expect(issuesOf(makeRuleset({ phases }))).toEqual([
        'phases.0.transitions.0.to: Transition targets undeclared phase "nowhere". Declared phases: "play", "done"',
      ]);
    });

    it("rejects a global transition to an undeclared phase", () => {
      const issues = issuesOf(makeRuleset({ globalTransitions: [{ to: "limbo", when: "true" }] }));
      expect(issues).toEqual([
        'globalTransitions.0.to: Global transition targets undeclared phase "limbo". Declared phases: "play", "done"',
      ]);
    });
  });

  describe("zone phaseOverrides", () => {
    it("rejects an override for an undeclared phase", () => {
      const zones = [
        {
          name: "table",
          visibility: { kind: "hidden" },
          owners: [],
          phaseOverrides: [{ phase: "showdown", visibility: { kind: "public" } }],
        },
      ];
      expect(issuesOf(makeRuleset({ zones }))).toEqual([
        'zones.0.phaseOverrides.0.phase: Zone "table" overrides visibility for undeclared phase "showdown". Declared phases: "play", "done"',
      ]);
    });

    it("accepts an override for a declared phase", () => {
      const zones = [
        {
          name: "table",
          visibility: { kind: "hidden" },
          owners: [],
          phaseOverrides: [{ phase: "done", visibility: { kind: "public" } }],
        },
      ];
      expect(issuesOf(makeRuleset({ zones }))).toEqual([]);
    });
  });

  // ─── Role names ──────────────────────────────────────────────────

  describe("zone owners", () => {
    it("rejects a zone owned by an undeclared role", () => {
      const zones = [{ name: "dealer_hand", visibility: { kind: "public" }, owners: ["dealer"] }];
      expect(issuesOf(makeRuleset({ zones }))).toEqual([
        'zones.0.owners.0: Zone "dealer_hand" is owned by undeclared role "dealer". Declared roles: "player"',
      ]);
    });
  });

  // ─── Partial visibility rules ────────────────────────────────────

  describe("partial visibility rule", () => {
    it("accepts each supported rule", () => {
      for (const rule of ["first_card_only", "last_card_only", "face_up_only"]) {
        const zones = [{ name: "table", visibility: { kind: "partial", rule }, owners: [] }];
        expect(issuesOf(makeRuleset({ zones }))).toEqual([]);
      }
    });

    it("rejects an unsupported rule", () => {
      const zones = [
        { name: "table", visibility: { kind: "partial", rule: "top_two" }, owners: [] },
      ];
      const issues = issuesOf(makeRuleset({ zones }));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^zones\.0\.visibility\.rule: /);
    });
  });

  // ─── Expression syntax ───────────────────────────────────────────

  describe("expression syntax", () => {
    it("rejects a syntax error in an action condition, naming the expression", () => {
      const phases = [
        { ...PLAY_PHASE, actions: [{ name: "go", label: "Go", condition: "a = b", effect: [] }] },
        DONE_PHASE,
      ];
      const issues = issuesOf(makeRuleset({ phases }));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("phases.0.actions.0.condition: Invalid expression:");
      expect(issues[0]).toContain(`(in expression: "a = b")`);
    });

    it("rejects a syntax error in an action effect", () => {
      const phases = [
        { ...PLAY_PHASE, actions: [{ name: "go", label: "Go", effect: ["ok()", "deal(deck,"] }] },
        DONE_PHASE,
      ];
      expect(issuesOf(makeRuleset({ phases }))[0]).toMatch(
        /^phases\.0\.actions\.0\.effect\.1: Invalid expression:/,
      );
    });

    it("rejects a syntax error in a transition condition", () => {
      const phases = [{ ...PLAY_PHASE, transitions: [{ to: "done", when: "x >" }] }, DONE_PHASE];
      expect(issuesOf(makeRuleset({ phases }))[0]).toMatch(
        /^phases\.0\.transitions\.0\.when: Invalid expression:/,
      );
    });

    it("rejects a syntax error in phase hooks and autoEndTurnCondition", () => {
      const phases = [
        { ...PLAY_PHASE, onEnter: ["shuffle(deck"], autoEndTurnCondition: "&& true" },
        DONE_PHASE,
      ];
      const paths = issuesOf(makeRuleset({ phases })).map((i) => i.split(":")[0]);
      expect(paths).toEqual(["phases.0.onEnter.0", "phases.0.autoEndTurnCondition"]);
    });

    it("rejects a syntax error in a global transition condition", () => {
      const issues = issuesOf(makeRuleset({ globalTransitions: [{ to: "done", when: "((" }] }));
      expect(issues[0]).toMatch(/^globalTransitions\.0\.when: Invalid expression:/);
    });

    it("rejects a syntax error in scoring expressions", () => {
      const scoring = {
        method: "card_count(",
        winCondition: "my_score > 0",
        bustCondition: "my_score >> 21",
        tieCondition: "false",
      };
      const paths = issuesOf(makeRuleset({ scoring })).map((i) => i.split(":")[0]);
      expect(paths).toEqual(["scoring.method", "scoring.bustCondition"]);
    });

    it("rejects an empty effect expression", () => {
      const phases = [
        { ...PLAY_PHASE, actions: [{ name: "go", label: "Go", effect: [""] }] },
        DONE_PHASE,
      ];
      expect(issuesOf(makeRuleset({ phases }))[0]).toContain("Empty expression");
    });

    it("does not reject unknown identifiers — those are runtime concerns", () => {
      const scoring = { method: "some_future_builtin(1)", winCondition: "unknown_flag" };
      expect(issuesOf(makeRuleset({ scoring }))).toEqual([]);
    });
  });

  // ─── loadRuleset ─────────────────────────────────────────────────

  describe("loadRuleset", () => {
    it("reports cross-reference issues through RulesetParseError", () => {
      const zones = [{ name: "dealer_hand", visibility: { kind: "public" }, owners: ["dealer"] }];
      let caught: unknown;
      try {
        loadRuleset(makeRuleset({ zones }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RulesetParseError);
      expect((caught as RulesetParseError).issues).toEqual([
        'zones.0.owners.0: Zone "dealer_hand" is owned by undeclared role "dealer". Declared roles: "player"',
      ]);
    });

    it("reports every problem, not just the first", () => {
      const zones = [{ name: "z", visibility: { kind: "public" }, owners: ["a", "b"] }];
      const phases = [{ ...PLAY_PHASE, transitions: [{ to: "nowhere", when: "(" }] }, DONE_PHASE];
      expect(issuesOf(makeRuleset({ zones, phases }))).toHaveLength(4);
    });
  });
});
