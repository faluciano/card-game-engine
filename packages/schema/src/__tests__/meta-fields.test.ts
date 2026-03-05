// ─── Schema Meta Fields & Bug Fixes Tests ─────────────────────────
// Validates optional meta fields ($schema, description, tags, license),
// their constraints, and verifies JSON Schema bug fixes for custom
// decks, variables manifest, and tieCondition.

import { describe, it, expect } from "vitest";
import { safeParseRuleset } from "../index";

// ─── Helper: Minimal Valid Ruleset Factory ─────────────────────────

/** Returns a minimal valid ruleset object that passes Zod validation. */
function makeMinimalRuleset(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const base = {
    meta: {
      name: "Test Game",
      slug: "test-game",
      version: "1.0.0",
      author: "test-author",
      players: { min: 1, max: 4 },
    },
    deck: {
      preset: "standard_52",
      copies: 1,
      cardValues: {
        A: { kind: "fixed", value: 1 },
      },
    },
    zones: [
      {
        name: "draw_pile",
        visibility: { kind: "hidden" },
        owners: [],
      },
    ],
    roles: [{ name: "player", isHuman: true, count: "per_player" }],
    phases: [
      {
        name: "play",
        kind: "turn_based",
        actions: [
          {
            name: "pass",
            label: "Pass",
            effect: ["end_turn()"],
          },
        ],
        transitions: [{ to: "play", when: "all_players_done" }],
      },
    ],
    scoring: {
      method: "hand_value(current_player.hand, 21)",
      winCondition: "my_score > 0",
    },
    ui: {
      layout: "semicircle",
      tableColor: "felt_green",
    },
  };

  // Deep merge meta overrides if provided
  if (overrides.meta && typeof overrides.meta === "object") {
    return {
      ...base,
      ...overrides,
      meta: { ...(base.meta as Record<string, unknown>), ...(overrides.meta as Record<string, unknown>) },
    };
  }

  return { ...base, ...overrides };
}

// ─── Group 1: Optional Meta Fields Accepted ───────────────────────

describe("optional meta fields accepted", () => {
  it("parses ruleset with description field", () => {
    const ruleset = makeMinimalRuleset({
      meta: { description: "A simple test card game" },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.description).toBe("A simple test card game");
    }
  });

  it("parses ruleset with tags field", () => {
    const ruleset = makeMinimalRuleset({
      meta: { tags: ["strategy", "classic", "family"] },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.tags).toEqual(["strategy", "classic", "family"]);
    }
  });

  it("parses ruleset with license field", () => {
    const ruleset = makeMinimalRuleset({
      meta: { license: "MIT" },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.license).toBe("MIT");
    }
  });

  it("parses ruleset with ALL optional meta fields", () => {
    const ruleset = makeMinimalRuleset({
      meta: {
        description: "Full featured game",
        tags: ["multiplayer", "cards"],
        license: "Apache-2.0",
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.description).toBe("Full featured game");
      expect(result.data.meta.tags).toEqual(["multiplayer", "cards"]);
      expect(result.data.meta.license).toBe("Apache-2.0");
    }
  });

  it("parses ruleset WITHOUT optional meta fields (backward compat)", () => {
    const ruleset = makeMinimalRuleset();

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.description).toBeUndefined();
      expect(result.data.meta.tags).toBeUndefined();
      expect(result.data.meta.license).toBeUndefined();
    }
  });
});

// ─── Group 2: Meta Field Validation ───────────────────────────────

describe("meta field validation", () => {
  it("rejects empty description string", () => {
    const ruleset = makeMinimalRuleset({
      meta: { description: "" },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
    if (!result.success) {
      const descIssue = result.error.issues.find(
        (i) => i.path.includes("description")
      );
      expect(descIssue).toBeDefined();
    }
  });

  it("rejects empty strings in tags array", () => {
    const ruleset = makeMinimalRuleset({
      meta: { tags: ["valid", ""] },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
    if (!result.success) {
      const tagsIssue = result.error.issues.find(
        (i) => i.path.includes("tags")
      );
      expect(tagsIssue).toBeDefined();
    }
  });

  it("accepts empty tags array", () => {
    const ruleset = makeMinimalRuleset({
      meta: { tags: [] },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.tags).toEqual([]);
    }
  });

  it("rejects empty license string", () => {
    const ruleset = makeMinimalRuleset({
      meta: { license: "" },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
    if (!result.success) {
      const licenseIssue = result.error.issues.find(
        (i) => i.path.includes("license")
      );
      expect(licenseIssue).toBeDefined();
    }
  });
});

// ─── Group 3: $schema Field ───────────────────────────────────────

describe("$schema field", () => {
  it("parses ruleset with $schema URL string", () => {
    const ruleset = makeMinimalRuleset({
      $schema: "https://card-engine.dev/schemas/v1/cardgame.schema.json",
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.$schema).toBe(
        "https://card-engine.dev/schemas/v1/cardgame.schema.json"
      );
    }
  });

  it("parses ruleset without $schema (backward compat)", () => {
    const ruleset = makeMinimalRuleset();

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.$schema).toBeUndefined();
    }
  });

  it("rejects $schema with empty string", () => {
    const ruleset = makeMinimalRuleset({
      $schema: "",
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
    if (!result.success) {
      const schemaIssue = result.error.issues.find(
        (i) => i.path.includes("$schema")
      );
      expect(schemaIssue).toBeDefined();
    }
  });
});

// ─── Group 4: JSON Schema Bug Fixes Verification ──────────────────

describe("JSON Schema bug fixes verification", () => {
  it("parses ruleset with deck.preset: 'custom' and custom cards", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "custom",
        cards: [
          { suit: "stars", rank: "1" },
          { suit: "stars", rank: "2" },
          { suit: "moons", rank: "1" },
        ],
        copies: 1,
        cardValues: {
          "1": { kind: "fixed", value: 1 },
          "2": { kind: "fixed", value: 2 },
        },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deck.preset).toBe("custom");
      if (result.data.deck.preset === "custom") {
        expect(result.data.deck.cards).toHaveLength(3);
      }
    }
  });

  it("parses ruleset with variables manifest", () => {
    const ruleset = makeMinimalRuleset({
      variables: {
        round: { type: "number", initial: 1 },
        maxRounds: { type: "number", initial: 10 },
        bonusMultiplier: { type: "number", initial: 2 },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variables).toEqual({
        round: { type: "number", initial: 1 },
        maxRounds: { type: "number", initial: 10 },
        bonusMultiplier: { type: "number", initial: 2 },
      });
    }
  });

  it("parses ruleset with scoring.tieCondition", () => {
    const ruleset = makeMinimalRuleset({
      scoring: {
        method: "hand_value(current_player.hand, 21)",
        winCondition: "my_score > dealer_score",
        tieCondition: "my_score == dealer_score",
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scoring.tieCondition).toBe(
        "my_score == dealer_score"
      );
    }
  });
});

// ─── Deck copies boundary validation ───────────────────────────────

describe("Deck copies boundary validation", () => {
  it("accepts copies = 1 (minimum)", () => {
    const result = safeParseRuleset(
      makeMinimalRuleset({ deck: { preset: "standard_52", copies: 1, cardValues: { A: { kind: "fixed", value: 1 } } } })
    );
    expect(result.success).toBe(true);
  });

  it("accepts copies = 100 (maximum)", () => {
    const result = safeParseRuleset(
      makeMinimalRuleset({ deck: { preset: "standard_52", copies: 100, cardValues: { A: { kind: "fixed", value: 1 } } } })
    );
    expect(result.success).toBe(true);
  });

  it("rejects copies = 0 (below minimum)", () => {
    const result = safeParseRuleset(
      makeMinimalRuleset({ deck: { preset: "standard_52", copies: 0, cardValues: { A: { kind: "fixed", value: 1 } } } })
    );
    expect(result.success).toBe(false);
  });

  it("rejects copies = 101 (above maximum)", () => {
    const result = safeParseRuleset(
      makeMinimalRuleset({ deck: { preset: "standard_52", copies: 101, cardValues: { A: { kind: "fixed", value: 1 } } } })
    );
    expect(result.success).toBe(false);
  });
});

// ─── Card Value Numeric Shorthand ─────────────────────────────────

describe("card value numeric shorthand", () => {
  it("normalizes numeric shorthand to fixed card value", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: { "2": 2 },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deck.cardValues["2"]).toEqual({ kind: "fixed", value: 2 });
    }
  });

  it("passes through full fixed object form unchanged", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: { "2": { kind: "fixed", value: 2 } },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deck.cardValues["2"]).toEqual({ kind: "fixed", value: 2 });
    }
  });

  it("passes through dual object form unchanged", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: { A: { kind: "dual", low: 1, high: 11 } },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deck.cardValues["A"]).toEqual({ kind: "dual", low: 1, high: 11 });
    }
  });

  it("handles mixed shorthand and object forms together", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: {
          A: { kind: "dual", low: 1, high: 11 },
          "2": 2,
          "3": { kind: "fixed", value: 3 },
          K: 10,
        },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deck.cardValues["A"]).toEqual({ kind: "dual", low: 1, high: 11 });
      expect(result.data.deck.cardValues["2"]).toEqual({ kind: "fixed", value: 2 });
      expect(result.data.deck.cardValues["3"]).toEqual({ kind: "fixed", value: 3 });
      expect(result.data.deck.cardValues["K"]).toEqual({ kind: "fixed", value: 10 });
    }
  });

  it("rejects invalid card value types (string)", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: { "2": "two" },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
  });

  it("rejects invalid card value types (boolean)", () => {
    const ruleset = makeMinimalRuleset({
      deck: {
        preset: "standard_52",
        copies: 1,
        cardValues: { "2": true },
      },
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(false);
  });
});

// ─── globalTransitions ────────────────────────────────────────────

describe("globalTransitions field", () => {
  it("parses ruleset with globalTransitions", () => {
    const ruleset = makeMinimalRuleset({
      globalTransitions: [
        { to: "play", when: "card_count(current_player.hand) == 0" },
      ],
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globalTransitions).toEqual([
        { to: "play", when: "card_count(current_player.hand) == 0" },
      ]);
    }
  });

  it("parses ruleset without globalTransitions (backward compat)", () => {
    const ruleset = makeMinimalRuleset();

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globalTransitions).toBeUndefined();
    }
  });

  it("accepts empty globalTransitions array", () => {
    const ruleset = makeMinimalRuleset({
      globalTransitions: [],
    });

    const result = safeParseRuleset(ruleset);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.globalTransitions).toEqual([]);
    }
  });
});
