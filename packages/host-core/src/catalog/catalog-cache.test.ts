import { describe, it, expect } from "vitest";
import type { CatalogGame } from "@card-engine/shared";
import {
  DEFAULT_CATALOG_TTL_MS,
  isCatalogCacheFresh,
  parseCatalogCache,
  serializeCatalogCache,
} from "./catalog-cache";

const GAME: CatalogGame = {
  name: "War",
  slug: "war",
  version: "1.0.0",
  author: "a",
  players: { min: 2, max: 2 },
  file: "rulesets/war.cardgame.json",
};

describe("parseCatalogCache", () => {
  it("round-trips a serialized entry", () => {
    const raw = serializeCatalogCache([GAME], 1_000);
    expect(parseCatalogCache(raw)).toEqual({ fetchedAt: 1_000, games: [GAME] });
  });

  it("returns null for a missing entry", () => {
    expect(parseCatalogCache(null)).toBeNull();
  });

  it.each([
    "not json",
    "null",
    "42",
    "[]",
    "{}",
    JSON.stringify({ games: [] }),
    JSON.stringify({ fetchedAt: "yesterday", games: [] }),
    JSON.stringify({ fetchedAt: Number.NaN, games: [] }),
    JSON.stringify({ fetchedAt: 1, games: {} }),
  ])("returns null for malformed input %s", (raw) => {
    expect(parseCatalogCache(raw)).toBeNull();
  });
});

describe("isCatalogCacheFresh", () => {
  const entry = { fetchedAt: 10_000, games: [] };

  it("is fresh within the TTL", () => {
    expect(isCatalogCacheFresh(entry, 10_000, 1_000)).toBe(true);
    expect(isCatalogCacheFresh(entry, 11_000, 1_000)).toBe(true);
  });

  it("expires once the TTL has elapsed", () => {
    expect(isCatalogCacheFresh(entry, 11_001, 1_000)).toBe(false);
  });

  it("treats entries from the future as stale (clock skew)", () => {
    expect(isCatalogCacheFresh(entry, 9_999, 1_000)).toBe(false);
  });

  it("defaults to a 24 hour TTL", () => {
    expect(isCatalogCacheFresh(entry, 10_000 + DEFAULT_CATALOG_TTL_MS)).toBe(true);
    expect(isCatalogCacheFresh(entry, 10_001 + DEFAULT_CATALOG_TTL_MS)).toBe(false);
  });
});
