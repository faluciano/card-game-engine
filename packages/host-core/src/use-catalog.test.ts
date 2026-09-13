import { describe, it, expect } from "vitest";
import { parseCatalogEnvelope } from "./use-catalog";

describe("parseCatalogEnvelope", () => {
  it("returns the games array from a well-formed envelope", () => {
    const games = [{ slug: "war", name: "War" }];
    expect(parseCatalogEnvelope({ games })).toBe(games);
  });

  it("accepts an empty games array", () => {
    expect(parseCatalogEnvelope({ games: [] })).toEqual([]);
  });

  it.each([null, undefined, 42, "games", [], {}, { games: null }, { games: {} }, { games: "x" }])(
    "returns null for malformed input %j",
    (input) => {
      expect(parseCatalogEnvelope(input)).toBeNull();
    },
  );
});
