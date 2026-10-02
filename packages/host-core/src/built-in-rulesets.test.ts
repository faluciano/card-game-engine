import { describe, it, expect } from "vitest";
import { parseRuleset } from "@card-engine/shared/schema";
import crazyEightsJson from "../../../rulesets/crazy-eights.cardgame.json";
import { BUILT_IN_RULESETS, BUILT_IN_SLUGS, trustBundledRuleset } from "./built-in-rulesets";

// ─── Built-in rulesets ─────────────────────────────────────────────
// The bundled JSON is trusted at runtime (no Zod on the startup path), so
// these tests are what guarantees the trusted path matches the schema.

describe("trustBundledRuleset", () => {
  it("yields exactly what parseRuleset yields for every bundled ruleset", () => {
    expect(trustBundledRuleset(crazyEightsJson)).toEqual(parseRuleset(crazyEightsJson));
  });

  it("expands bare-number card values into the fixed object form", () => {
    const ruleset = trustBundledRuleset({
      deck: { cardValues: { "2": 2, A: { kind: "dual", low: 1, high: 11 } } },
    });
    expect(ruleset.deck.cardValues).toEqual({
      "2": { kind: "fixed", value: 2 },
      A: { kind: "dual", low: 1, high: 11 },
    });
  });

  it("does not mutate the bundled JSON module", () => {
    const before = JSON.stringify(crazyEightsJson);
    trustBundledRuleset(crazyEightsJson);
    expect(JSON.stringify(crazyEightsJson)).toBe(before);
  });
});

describe("BUILT_IN_RULESETS", () => {
  it("every bundled ruleset passes the schema", () => {
    for (const ruleset of BUILT_IN_RULESETS) {
      expect(() => parseRuleset(ruleset)).not.toThrow();
    }
  });

  it("exposes the crazy-eights slug", () => {
    expect(BUILT_IN_SLUGS).toContain("crazy-eights");
  });
});
