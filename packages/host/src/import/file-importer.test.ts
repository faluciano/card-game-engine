import { describe, it, expect, vi, beforeEach } from "vitest";
import * as FileSystem from "expo-file-system";
import { safeParseRuleset } from "@card-engine/shared";
import { importFromFile } from "./file-importer.js";

// ══════════════════════════════════════════════════════════════════════
// Mocks
// ══════════════════════════════════════════════════════════════════════

vi.mock("expo-file-system", async () => {
  return {
    EncodingType: { UTF8: "utf8", Base64: "base64" },
    readAsStringAsync: vi.fn(),
  };
});

vi.mock("@card-engine/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@card-engine/shared")>();
  return {
    ...actual,
    safeParseRuleset: vi.fn(),
  };
});

const mockReadFile = FileSystem.readAsStringAsync as ReturnType<typeof vi.fn>;
const mockSafeParseRuleset = safeParseRuleset as ReturnType<typeof vi.fn>;

// ══════════════════════════════════════════════════════════════════════
// Factories
// ══════════════════════════════════════════════════════════════════════

function makeRulesetData() {
  return {
    meta: { slug: "test-game", name: "Test Game", version: "1.0.0" },
    deck: { preset: "standard52" },
  };
}

function makeSuccessParseResult(data = makeRulesetData()) {
  return { success: true as const, data };
}

function makeFailureParseResult(
  issues: { path: (string | number)[]; message: string }[] = [
    { path: ["meta", "slug"], message: "Required" },
  ],
) {
  return { success: false as const, error: { issues } };
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("importFromFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Extension guard ──────────────────────────────────────────────

  describe("extension guard", () => {
    it("rejects non-.cardgame.json extension", async () => {
      const result = await importFromFile("/path/to/game.txt");

      expect(result).toEqual({
        ok: false,
        error: "File must have a .cardgame.json extension.",
      });
    });

    it("rejects file without any extension", async () => {
      const result = await importFromFile("/path/to/game");

      expect(result).toEqual({
        ok: false,
        error: "File must have a .cardgame.json extension.",
      });
    });

    it("rejects plain .json extension", async () => {
      const result = await importFromFile("/path/to/game.json");

      expect(result).toEqual({
        ok: false,
        error: "File must have a .cardgame.json extension.",
      });
    });
  });

  // ── Successful import ────────────────────────────────────────────

  describe("successful import", () => {
    it("reads file, parses JSON, validates, and returns ruleset", async () => {
      const rulesetData = makeRulesetData();
      mockReadFile.mockResolvedValue(JSON.stringify(rulesetData));
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      const result = await importFromFile("/path/to/my-game.cardgame.json");

      expect(result).toEqual({ ok: true, ruleset: rulesetData });
    });

    it("accepts nested paths", async () => {
      const rulesetData = makeRulesetData();
      mockReadFile.mockResolvedValue(JSON.stringify(rulesetData));
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      const result = await importFromFile(
        "/deep/nested/dir/game.cardgame.json",
      );

      expect(result).toEqual({ ok: true, ruleset: rulesetData });
    });
  });

  // ── Encoding option ──────────────────────────────────────────────

  describe("encoding option", () => {
    it("passes UTF8 encoding to readAsStringAsync", async () => {
      const rulesetData = makeRulesetData();
      mockReadFile.mockResolvedValue(JSON.stringify(rulesetData));
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      await importFromFile("/file.cardgame.json");

      expect(mockReadFile).toHaveBeenCalledWith("/file.cardgame.json", {
        encoding: "utf8",
      });
    });
  });

  // ── Parsed data forwarding ──────────────────────────────────────

  describe("parsed data forwarding", () => {
    it("passes the parsed JSON to safeParseRuleset", async () => {
      const rulesetData = makeRulesetData();
      mockReadFile.mockResolvedValue(JSON.stringify(rulesetData));
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      await importFromFile("/file.cardgame.json");

      expect(mockSafeParseRuleset).toHaveBeenCalledWith(rulesetData);
    });
  });

  // ── File read failure ────────────────────────────────────────────

  describe("file read failure", () => {
    it("returns error when readAsStringAsync throws", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT: file not found"));

      const result = await importFromFile("/missing.cardgame.json");

      expect(result).toEqual({
        ok: false,
        error: "Failed to read file: ENOENT: file not found",
      });
    });
  });

  // ── Invalid JSON ─────────────────────────────────────────────────

  describe("invalid JSON", () => {
    it("returns error for malformed JSON", async () => {
      mockReadFile.mockResolvedValue("not-json{{{");

      const result = await importFromFile("/bad.cardgame.json");

      expect(result).toEqual({
        ok: false,
        error: "File is not valid JSON.",
      });
    });
  });

  // ── Validation failure ───────────────────────────────────────────

  describe("validation failure", () => {
    it("returns formatted Zod issues when validation fails", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({}));
      mockSafeParseRuleset.mockReturnValue(
        makeFailureParseResult([
          { path: ["meta", "slug"], message: "Required" },
          { path: ["deck", "preset"], message: "Invalid" },
        ]),
      );

      const result = await importFromFile("/invalid.cardgame.json");

      expect(result).toEqual({
        ok: false,
        error:
          "Validation failed: meta.slug: Required; deck.preset: Invalid",
      });
    });
  });
});
