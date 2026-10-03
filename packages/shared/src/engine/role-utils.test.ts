import { describe, it, expect } from "vitest";
import { isHumanPlayer } from "./role-utils";

// ─── Fixtures ──────────────────────────────────────────────────────

const ROLES = [
  { name: "player", isHuman: true },
  { name: "dealer", isHuman: false },
] as const;

// ─── Tests ─────────────────────────────────────────────────────────

describe("isHumanPlayer", () => {
  it("returns true for a role declared as human", () => {
    expect(isHumanPlayer({ role: "player" }, ROLES)).toBe(true);
  });

  it("returns false for a role declared as non-human", () => {
    expect(isHumanPlayer({ role: "dealer" }, ROLES)).toBe(false);
  });

  it("throws for a role that is not declared, listing the declared roles", () => {
    expect(() => isHumanPlayer({ role: "ghost" }, ROLES)).toThrow(
      'Unknown role "ghost": not declared in ruleset roles. Declared roles: "player", "dealer"',
    );
  });

  it("throws when the ruleset declares no roles at all", () => {
    expect(() => isHumanPlayer({ role: "player" }, [])).toThrow("Declared roles: (none)");
  });
});
