import { describe, it, expect } from "vitest";
import {
  importResultToState,
  nextAvailableSlug,
  resolveImportSlug,
} from "./use-import-modal-model";

describe("nextAvailableSlug", () => {
  it("starts at -1", () => {
    expect(nextAvailableSlug("war", [])).toBe("war-1");
  });

  it("skips taken suffixes", () => {
    expect(nextAvailableSlug("war", ["war", "war-1", "war-2"])).toBe("war-3");
  });

  it("ignores unrelated slugs", () => {
    expect(nextAvailableSlug("war", ["blackjack-1"])).toBe("war-1");
  });
});

describe("importResultToState", () => {
  it("maps success", () => {
    expect(importResultToState({ ok: true, name: "War" }, [])).toEqual({
      tag: "success",
      name: "War",
    });
  });

  it("maps a duplicate with a suggested slug", () => {
    const result = importResultToState(
      { ok: false, duplicate: true, slug: "war", error: "exists" },
      ["war", "war-1"],
    );
    expect(result).toEqual({ tag: "duplicate", slug: "war", suggestedSlug: "war-2" });
  });

  it("maps an error", () => {
    expect(importResultToState({ ok: false, error: "HTTP 404" }, [])).toEqual({
      tag: "error",
      message: "HTTP 404",
    });
  });
});

describe("resolveImportSlug", () => {
  it("prefers the trimmed custom slug", () => {
    expect(resolveImportSlug("  my-war ", "war-1")).toBe("my-war");
  });

  it("falls back to the suggestion when blank", () => {
    expect(resolveImportSlug("   ", "war-1")).toBe("war-1");
  });
});
