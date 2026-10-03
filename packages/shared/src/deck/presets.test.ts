import { describe, it, expect } from "vitest";
import { getPresetDeck, instantiateCards, standard52, standard54 } from "./presets";

// ─── standard52 ────────────────────────────────────────────────────

describe("standard52", () => {
  it("produces 52 cards", () => {
    expect(standard52()).toHaveLength(52);
  });

  it("contains every suit/rank combination exactly once", () => {
    const keys = new Set(standard52().map((c) => `${c.rank}-${c.suit}`));
    expect(keys.size).toBe(52);
  });

  it("has 13 cards in each of the four standard suits", () => {
    for (const suit of ["hearts", "diamonds", "clubs", "spades"]) {
      expect(standard52().filter((c) => c.suit === suit)).toHaveLength(13);
    }
  });

  it("contains no jokers", () => {
    expect(standard52().some((c) => c.suit === "joker")).toBe(false);
  });

  it("returns a fresh array on each call", () => {
    expect(standard52()).not.toBe(standard52());
  });
});

// ─── standard54 ────────────────────────────────────────────────────

describe("standard54", () => {
  it("produces 54 cards", () => {
    expect(standard54()).toHaveLength(54);
  });

  it("is the standard 52 followed by two jokers", () => {
    const deck = standard54();
    expect(deck.slice(0, 52)).toEqual(standard52());
    expect(deck.slice(52)).toEqual([
      { suit: "joker", rank: "Joker" },
      { suit: "joker", rank: "Joker" },
    ]);
  });
});

// ─── getPresetDeck ─────────────────────────────────────────────────

describe("getPresetDeck", () => {
  it("returns the 52-card deck for standard_52", () => {
    expect(getPresetDeck("standard_52")).toEqual(standard52());
  });

  it("returns the 54-card deck for standard_54", () => {
    expect(getPresetDeck("standard_54")).toEqual(standard54());
  });
});

// ─── instantiateCards ──────────────────────────────────────────────

describe("instantiateCards", () => {
  const templates = [
    { suit: "hearts", rank: "A" },
    { suit: "spades", rank: "K" },
  ] as const;

  it("creates one face-down card per template by default", () => {
    const cards = instantiateCards(templates);
    expect(cards).toHaveLength(2);
    expect(cards.map(({ suit, rank, faceUp }) => ({ suit, rank, faceUp }))).toEqual([
      { suit: "hearts", rank: "A", faceUp: false },
      { suit: "spades", rank: "K", faceUp: false },
    ]);
  });

  it("repeats the full template list for each copy", () => {
    const cards = instantiateCards(templates, 3);
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.rank)).toEqual(["A", "K", "A", "K", "A", "K"]);
  });

  it("assigns a unique instance id to every card", () => {
    const cards = instantiateCards(standard52(), 2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(104);
  });

  it("returns an empty array for no templates", () => {
    expect(instantiateCards([])).toEqual([]);
  });

  it("returns an empty array for zero copies", () => {
    expect(instantiateCards(templates, 0)).toEqual([]);
  });
});
