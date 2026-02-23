// ─── Deck Presets ──────────────────────────────────────────────────
// Factory functions for well-known deck configurations.
// Each preset produces an array of Card objects (without instance IDs —
// those are assigned when the deck is instantiated into a game).

import type { Rank, Suit, StandardSuit, StandardRank, CardInstanceId, Card } from "../types/index";

/** A card template before it gets a unique instance ID. */
export interface CardTemplate {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** All four standard suits. */
const STANDARD_SUITS: readonly StandardSuit[] = [
  "hearts",
  "diamonds",
  "clubs",
  "spades",
];

/** All thirteen standard ranks. */
const STANDARD_RANKS: readonly StandardRank[] = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

/**
 * Standard 52-card deck: 4 suits × 13 ranks, no jokers.
 */
export function standard52(): readonly CardTemplate[] {
  const cards: CardTemplate[] = [];
  for (const suit of STANDARD_SUITS) {
    for (const rank of STANDARD_RANKS) {
      cards.push({ suit, rank });
    }
  }
  return cards;
}

/**
 * Standard 54-card deck: 52 cards + 2 jokers.
 */
export function standard54(): readonly CardTemplate[] {
  const base = standard52();
  return [
    ...base,
    { suit: "joker", rank: "Joker" },
    { suit: "joker", rank: "Joker" },
  ];
}

/**
 * UNO 108-card deck.
 * 4 colors × (one 0 + two each of 1–9, Skip, Reverse, Draw Two) + 4 Wild + 4 Wild Draw Four.
 */
export function uno108(): readonly CardTemplate[] {
  const colors: readonly string[] = ["red", "yellow", "green", "blue"];
  const numberRanks = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const actionRanks = ["Skip", "Reverse", "Draw Two"];
  const cards: CardTemplate[] = [];

  for (const color of colors) {
    // One 0 per color
    cards.push({ suit: color, rank: "0" });
    // Two each of 1–9 and action cards
    for (const rank of [...numberRanks.slice(1), ...actionRanks]) {
      cards.push({ suit: color, rank });
      cards.push({ suit: color, rank });
    }
  }

  // 4 Wild and 4 Wild Draw Four
  for (let i = 0; i < 4; i++) {
    cards.push({ suit: "wild", rank: "Wild" });
    cards.push({ suit: "wild", rank: "Wild Draw Four" });
  }

  return cards;
}

/**
 * Looks up a preset by name and returns its card templates.
 * @throws {Error} for unknown preset names.
 */
export function getPresetDeck(
  preset: "standard_52" | "standard_54" | "uno_108"
): readonly CardTemplate[] {
  switch (preset) {
    case "standard_52":
      return standard52();
    case "standard_54":
      return standard54();
    case "uno_108":
      return uno108();
  }
}

/** Creates a unique CardInstanceId. */
export function createCardInstanceId(): CardInstanceId {
  return crypto.randomUUID() as CardInstanceId;
}

/**
 * Instantiates card templates into Card objects with unique IDs.
 * Cards start face-down by default.
 */
export function instantiateCards(
  templates: readonly CardTemplate[],
  copies: number = 1
): readonly Card[] {
  const cards: Card[] = [];
  for (let copy = 0; copy < copies; copy++) {
    for (const template of templates) {
      cards.push({
        id: createCardInstanceId(),
        suit: template.suit,
        rank: template.rank,
        faceUp: false,
      });
    }
  }
  return cards;
}
