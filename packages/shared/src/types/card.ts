// ─── Card Primitives ───────────────────────────────────────────────
// Foundational types for representing cards, suits, ranks, and zones.
// Uses literal types and discriminated unions to make illegal states
// unrepresentable at the type level.

/** Standard suit literals for traditional playing cards. */
export type StandardSuit = "hearts" | "diamonds" | "clubs" | "spades";

/** Suits that extend beyond standard (e.g., UNO colors). */
export type ExtendedSuit = string;

/** Combined suit type — standard or custom. */
export type Suit = StandardSuit | ExtendedSuit;

/** Standard rank literals (Ace through King). */
export type StandardRank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

/** Extended rank for non-standard decks (e.g., "Skip", "Reverse"). */
export type ExtendedRank = string;

/** Combined rank type — standard or custom. */
export type Rank = StandardRank | ExtendedRank;

// ─── Card ──────────────────────────────────────────────────────────

/** A unique identifier for a specific card instance in the game. */
export type CardInstanceId = string & { readonly __brand: unique symbol };

/**
 * A card instance in play. Each physical card gets a unique ID so we
 * can track it across zones without ambiguity, even with duplicate
 * ranks/suits in multi-deck games.
 */
export interface Card {
  readonly id: CardInstanceId;
  readonly suit: Suit;
  readonly rank: Rank;
  /** Whether this card is currently face-up (visible to all). */
  readonly faceUp: boolean;
}

// ─── Card Value ────────────────────────────────────────────────────

/**
 * Defines the numeric value(s) a card can take in scoring.
 * Discriminated on `kind` to handle fixed vs. dual-value (e.g., Ace).
 */
export type CardValue =
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "dual"; readonly low: number; readonly high: number };

/**
 * Maps a rank string to its value definition.
 * Used in ruleset deck configuration.
 */
export type CardValueMap = Readonly<Record<Rank, CardValue>>;

// ─── Zone ──────────────────────────────────────────────────────────

/** Who can see the cards in a zone. Discriminated union. */
export type ZoneVisibility =
  | { readonly kind: "public" }
  | { readonly kind: "owner_only" }
  | { readonly kind: "hidden" }
  | { readonly kind: "partial"; readonly rule: string };

/** A named region where cards can reside during a game. */
export interface ZoneDefinition {
  readonly name: string;
  readonly visibility: ZoneVisibility;
  /** Which role(s) own this zone. Empty means shared. */
  readonly owners: readonly string[];
  /** Maximum number of cards this zone can hold, if any. */
  readonly maxCards?: number;
}

/** Runtime state of a zone: its definition plus current contents. */
export interface ZoneState {
  readonly definition: ZoneDefinition;
  readonly cards: readonly Card[];
}
