import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RulesetStoreCorruptError,
  RulesetStoreQuotaError,
  generateRulesetId,
  isQuotaExceededError,
} from "./ruleset-store";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ─── generateRulesetId ─────────────────────────────────────────────

describe("generateRulesetId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as `${string}-${string}-${string}-${string}-${string}`,
    );
    expect(generateRulesetId()).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  it("falls back to a well-formed v4 UUID when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {});
    expect(generateRulesetId()).toMatch(UUID_V4);
  });

  it("falls back when crypto itself is undefined", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateRulesetId()).toMatch(UUID_V4);
  });

  it("produces distinct fallback IDs across calls", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 50 }, () => generateRulesetId()));
    expect(ids.size).toBe(50);
  });
});

// ─── Errors ────────────────────────────────────────────────────────

describe("RulesetStoreCorruptError", () => {
  it("names itself and keeps the source", () => {
    const err = new RulesetStoreCorruptError("file:///x/_metadata.json", new SyntaxError("bad"));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RulesetStoreCorruptError");
    expect(err.source).toBe("file:///x/_metadata.json");
    expect(err.message).toContain("file:///x/_metadata.json");
    expect(err.message).toContain("bad");
    expect(err.message).toContain("not overwritten");
  });

  it("stringifies a non-Error cause", () => {
    const err = new RulesetStoreCorruptError("key", "not an object");
    expect(err.message).toContain("not an object");
  });
});

describe("RulesetStoreQuotaError", () => {
  it("names itself and reports the payload size", () => {
    const err = new RulesetStoreQuotaError(1234);
    expect(err.name).toBe("RulesetStoreQuotaError");
    expect(err.payloadSize).toBe(1234);
    expect(err.message).toContain("1234");
    expect(err.message).toMatch(/storage is full/i);
  });
});

describe("isQuotaExceededError", () => {
  it("matches the standard DOMException name", () => {
    expect(isQuotaExceededError({ name: "QuotaExceededError" })).toBe(true);
  });

  it("matches the legacy Firefox name", () => {
    expect(isQuotaExceededError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
  });

  it("matches the legacy WebKit code 22", () => {
    expect(isQuotaExceededError({ name: "Error", code: 22 })).toBe(true);
  });

  it("rejects other errors and non-objects", () => {
    expect(isQuotaExceededError(new Error("nope"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError("QuotaExceededError")).toBe(false);
    expect(isQuotaExceededError(undefined)).toBe(false);
  });
});
