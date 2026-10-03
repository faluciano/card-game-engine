import { describe, it, expect } from "vitest";
import type { CatalogGame } from "@card-engine/shared";
import {
  clearInFlight,
  formatSelectError,
  markInFlight,
  safeLocalStorage,
} from "./catalog-install.js";

const GAME: CatalogGame = {
  name: "Hearts",
  slug: "hearts",
  version: "1.0.0",
  author: "test",
  players: { min: 4, max: 4 },
  file: "rulesets/hearts.cardgame.json",
};

describe("formatSelectError", () => {
  it("includes the game name and the error message", () => {
    expect(formatSelectError(GAME, new Error("HTTP 404"))).toBe(
      "Could not select Hearts: HTTP 404",
    );
  });

  it("falls back for non-Error throwables", () => {
    expect(formatSelectError(GAME, "boom")).toBe("Could not select Hearts: Selection failed");
  });
});

describe("in-flight set helpers", () => {
  it("markInFlight adds a slug without mutating the input", () => {
    const empty: ReadonlySet<string> = new Set();
    const next = markInFlight(empty, "hearts");
    expect(next.has("hearts")).toBe(true);
    expect(empty.size).toBe(0);
  });

  it("markInFlight returns the same set when the slug is already in flight", () => {
    const set: ReadonlySet<string> = new Set(["hearts"]);
    expect(markInFlight(set, "hearts")).toBe(set);
  });

  it("clearInFlight removes a slug and is a no-op for unknown slugs", () => {
    const set: ReadonlySet<string> = new Set(["hearts", "war"]);
    expect([...clearInFlight(set, "hearts")]).toEqual(["war"]);
    expect(clearInFlight(set, "poker")).toBe(set);
  });
});

describe("safeLocalStorage", () => {
  it("returns null when localStorage is not available (node test environment)", () => {
    expect(safeLocalStorage()).toBeNull();
  });
});
