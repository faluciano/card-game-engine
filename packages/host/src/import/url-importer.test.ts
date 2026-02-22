import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeParseRuleset } from "@card-engine/shared";
import { importFromUrl } from "./url-importer.js";

// ══════════════════════════════════════════════════════════════════════
// Mocks
// ══════════════════════════════════════════════════════════════════════

vi.mock("@card-engine/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@card-engine/shared")>();
  return {
    ...actual,
    safeParseRuleset: vi.fn(),
  };
});

const mockSafeParseRuleset = safeParseRuleset as ReturnType<typeof vi.fn>;
const mockFetch = vi.fn();

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

function makeMockResponse(
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    text?: string;
    contentLength?: string | null;
  } = {},
): Response {
  const {
    ok = true,
    status = 200,
    statusText = "OK",
    text = "{}",
    contentLength = null,
  } = options;
  return {
    ok,
    status,
    statusText,
    headers: new Headers(
      contentLength !== null ? { "content-length": contentLength } : {},
    ),
    text: async () => text,
  } as unknown as Response;
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("importFromUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── HTTPS guard ──────────────────────────────────────────────────

  describe("HTTPS guard", () => {
    it("rejects non-HTTPS URL", async () => {
      const result = await importFromUrl("ftp://example.com/file.json");

      expect(result).toEqual({
        ok: false,
        error: "Only HTTPS URLs are allowed.",
      });
    });

    it("rejects HTTP URL", async () => {
      const result = await importFromUrl("http://example.com/file.json");

      expect(result).toEqual({
        ok: false,
        error: "Only HTTPS URLs are allowed.",
      });
    });
  });

  // ── Successful import ────────────────────────────────────────────

  describe("successful import", () => {
    it("fetches, parses, validates, and returns ruleset", async () => {
      const rulesetData = makeRulesetData();
      mockFetch.mockResolvedValue(
        makeMockResponse({ text: JSON.stringify(rulesetData) }),
      );
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({ ok: true, ruleset: rulesetData });
      expect(mockFetch).toHaveBeenCalledWith("https://example.com/game.json");
    });
  });

  // ── Network failure ──────────────────────────────────────────────

  describe("network failure", () => {
    it("returns error when fetch throws", async () => {
      mockFetch.mockRejectedValue(new Error("DNS resolution failed"));

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({
        ok: false,
        error: "Network request failed: DNS resolution failed",
      });
    });
  });

  // ── Non-OK response ──────────────────────────────────────────────

  describe("non-OK response", () => {
    it("returns HTTP status error for 404", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ ok: false, status: 404, statusText: "Not Found" }),
      );

      const result = await importFromUrl("https://example.com/missing.json");

      expect(result).toEqual({
        ok: false,
        error: "HTTP 404: Not Found",
      });
    });
  });

  // ── Content-Length guard ─────────────────────────────────────────

  describe("content-length guard", () => {
    it("rejects response when content-length exceeds limit", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ contentLength: "2000000" }),
      );

      const result = await importFromUrl("https://example.com/large.json");

      expect(result).toEqual({
        ok: false,
        error:
          "Response too large: 2000000 bytes exceeds the 1048576 byte limit.",
      });
    });

    it("ignores NaN content-length header and proceeds", async () => {
      const rulesetData = makeRulesetData();
      mockFetch.mockResolvedValue(
        makeMockResponse({
          contentLength: "not-a-number",
          text: JSON.stringify(rulesetData),
        }),
      );
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({ ok: true, ruleset: rulesetData });
    });
  });

  // ── Body size guard ──────────────────────────────────────────────

  describe("body size guard", () => {
    it("rejects body larger than maxSizeBytes when no content-length header", async () => {
      const largeBody = "x".repeat(200);
      mockFetch.mockResolvedValue(
        makeMockResponse({ text: largeBody }),
      );

      const result = await importFromUrl(
        "https://example.com/game.json",
        100,
      );

      expect(result).toEqual({
        ok: false,
        error: "Response too large: 200 bytes exceeds the 100 byte limit.",
      });
    });
  });

  // ── Custom maxSizeBytes ──────────────────────────────────────────

  describe("custom maxSizeBytes", () => {
    it("uses default maxSizeBytes of 1 MB", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ contentLength: "1048577" }),
      );

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({
        ok: false,
        error:
          "Response too large: 1048577 bytes exceeds the 1048576 byte limit.",
      });
    });

    it("respects custom maxSizeBytes parameter", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ contentLength: "501" }),
      );

      const result = await importFromUrl(
        "https://example.com/game.json",
        500,
      );

      expect(result).toEqual({
        ok: false,
        error: "Response too large: 501 bytes exceeds the 500 byte limit.",
      });
    });
  });

  // ── Invalid JSON ─────────────────────────────────────────────────

  describe("invalid JSON", () => {
    it("returns error for malformed JSON response", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ text: "not-json{{{" }),
      );

      const result = await importFromUrl("https://example.com/bad.json");

      expect(result).toEqual({
        ok: false,
        error: "Response is not valid JSON.",
      });
    });
  });

  // ── Validation failure ───────────────────────────────────────────

  describe("validation failure", () => {
    it("returns formatted Zod issues when validation fails", async () => {
      mockFetch.mockResolvedValue(
        makeMockResponse({ text: JSON.stringify({}) }),
      );
      mockSafeParseRuleset.mockReturnValue(
        makeFailureParseResult([
          { path: ["meta", "slug"], message: "Required" },
          { path: ["deck", "preset"], message: "Invalid" },
        ]),
      );

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({
        ok: false,
        error:
          "Validation failed: meta.slug: Required; deck.preset: Invalid",
      });
    });
  });

  // ── response.text() failure ──────────────────────────────────────

  describe("response.text() failure", () => {
    it("returns error when response.text() throws", async () => {
      const response = makeMockResponse();
      (response as { text: () => Promise<string> }).text = async () => {
        throw new Error("Stream interrupted");
      };
      mockFetch.mockResolvedValue(response);

      const result = await importFromUrl("https://example.com/game.json");

      expect(result).toEqual({
        ok: false,
        error: "Failed to read response body: Stream interrupted",
      });
    });
  });

  // ── Edge: empty-ish URL ──────────────────────────────────────────

  describe("edge cases", () => {
    it("empty string URL with https:// prefix still calls fetch", async () => {
      const rulesetData = makeRulesetData();
      mockFetch.mockResolvedValue(
        makeMockResponse({ text: JSON.stringify(rulesetData) }),
      );
      mockSafeParseRuleset.mockReturnValue(makeSuccessParseResult(rulesetData));

      const result = await importFromUrl("https://");

      expect(mockFetch).toHaveBeenCalledWith("https://");
      expect(result).toEqual({ ok: true, ruleset: rulesetData });
    });
  });
});
