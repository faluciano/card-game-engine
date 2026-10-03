import { describe, it, expect } from "vitest";
import type { CardGameRuleset } from "../types/index";
import { getEngine, getPhaseMachine } from "./engine-cache";

// ─── Fixtures ──────────────────────────────────────────────────────

function makeRuleset(slug: string): CardGameRuleset {
  return {
    meta: { name: slug, slug, version: "1.0.0", author: "test", players: { min: 1, max: 2 } },
    deck: { preset: "standard_52", copies: 1, cardValues: { A: { kind: "fixed", value: 1 } } },
    zones: [{ name: "draw_pile", visibility: { kind: "hidden" }, owners: [] }],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    phases: [{ name: "play", kind: "turn_based", actions: [], transitions: [] }],
    scoring: { method: "0", winCondition: "false" },
    ui: { layout: "semicircle", tableColor: "felt_green" },
  };
}

// ─── getEngine ─────────────────────────────────────────────────────

describe("getEngine", () => {
  it("returns the same engine for the same ruleset object", () => {
    const ruleset = makeRuleset("a");
    expect(getEngine(ruleset)).toBe(getEngine(ruleset));
  });

  it("returns distinct engines for distinct rulesets", () => {
    expect(getEngine(makeRuleset("a"))).not.toBe(getEngine(makeRuleset("a")));
  });

  it("binds the engine to its ruleset", () => {
    const ruleset = makeRuleset("bound");
    expect(getEngine(ruleset).ruleset).toBe(ruleset);
  });
});

// ─── getPhaseMachine ───────────────────────────────────────────────

describe("getPhaseMachine", () => {
  it("shares the cached engine's phase machine", () => {
    const ruleset = makeRuleset("pm");
    expect(getPhaseMachine(ruleset)).toBe(getEngine(ruleset).phaseMachine);
  });
});
