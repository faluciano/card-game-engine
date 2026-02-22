import { describe, it, expect } from "vitest";
import { formatZodIssues } from "./format-zod-issues.js";

// ══════════════════════════════════════════════════════════════════════
// Factories
// ══════════════════════════════════════════════════════════════════════

function makeIssue(
  path: readonly (string | number)[],
  message: string,
): { readonly path: readonly (string | number)[]; readonly message: string } {
  return { path, message };
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("formatZodIssues", () => {
  // ── Single issue ─────────────────────────────────────────────────

  describe("single issue with path", () => {
    it("formats as 'Validation failed: path: message'", () => {
      const issues = [makeIssue(["meta", "slug"], "Required")];

      const result = formatZodIssues(issues);

      expect(result).toBe("Validation failed: meta.slug: Required");
    });
  });

  // ── Multiple issues ──────────────────────────────────────────────

  describe("multiple issues", () => {
    it("joins issues with '; '", () => {
      const issues = [
        makeIssue(["meta", "slug"], "Required"),
        makeIssue(["deck", "preset"], "Invalid"),
      ];

      const result = formatZodIssues(issues);

      expect(result).toBe(
        "Validation failed: meta.slug: Required; deck.preset: Invalid",
      );
    });
  });

  // ── Root-level issues ────────────────────────────────────────────

  describe("root-level issues", () => {
    it("uses '(root)' for empty path", () => {
      const issues = [makeIssue([], "Expected object, received array")];

      const result = formatZodIssues(issues);

      expect(result).toBe(
        "Validation failed: (root): Expected object, received array",
      );
    });

    it("formats single root issue correctly", () => {
      const issues = [makeIssue([], "Required")];

      const result = formatZodIssues(issues);

      expect(result).toBe("Validation failed: (root): Required");
    });
  });

  // ── Nested paths with numbers ────────────────────────────────────

  describe("nested path with numbers", () => {
    it("joins path segments with '.'", () => {
      const issues = [makeIssue(["phases", 0, "name"], "Required")];

      const result = formatZodIssues(issues);

      expect(result).toBe("Validation failed: phases.0.name: Required");
    });
  });

  // ── Empty issues array ───────────────────────────────────────────

  describe("empty issues array", () => {
    it("returns 'Validation failed: ' with no details", () => {
      const result = formatZodIssues([]);

      expect(result).toBe("Validation failed: ");
    });
  });

  // ── Mixed root and nested ────────────────────────────────────────

  describe("mixed root and nested issues", () => {
    it("renders both (root) and dotted paths", () => {
      const issues = [
        makeIssue([], "Must be an object"),
        makeIssue(["meta", "name"], "Too short"),
        makeIssue(["zones", 2, "visibility", "kind"], "Invalid enum value"),
      ];

      const result = formatZodIssues(issues);

      expect(result).toBe(
        "Validation failed: (root): Must be an object; meta.name: Too short; zones.2.visibility.kind: Invalid enum value",
      );
    });
  });

  // ── Deeply nested path ───────────────────────────────────────────

  describe("deeply nested path", () => {
    it("formats long path correctly", () => {
      const issues = [
        makeIssue(
          ["phases", 0, "actions", 3, "conditions", 1, "type"],
          "Invalid",
        ),
      ];

      const result = formatZodIssues(issues);

      expect(result).toBe(
        "Validation failed: phases.0.actions.3.conditions.1.type: Invalid",
      );
    });
  });
});
