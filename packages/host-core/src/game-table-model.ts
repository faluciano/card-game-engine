// ─── Game Table Model ──────────────────────────────────────────────
// Framework-free view-model for the game table screen shared by the TV
// host (React Native) and the browser display (DOM). Everything that is
// not JSX lives here: zone grouping, visibility, labels, score rows,
// overlay data, card-collapse rules and animation timing constants. The
// renderers only map these values to native / DOM elements.

import type { Card, CardGameState, Player, UIConfig, ZoneState } from "@card-engine/shared";
import { colors } from "./theme";

// ─── Constants ─────────────────────────────────────────────────────

export const SUIT_SYMBOLS: Readonly<Record<string, string>> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const RED_SUITS: ReadonlySet<string> = new Set(["hearts", "diamonds"]);

/** Maximum face-up cards rendered before showing a "+N more" indicator. */
export const MAX_VISIBLE_CARDS = 12;

/** Threshold above which an all-face-down zone collapses to a stacked icon. */
export const STACK_COLLAPSE_THRESHOLD = 6;

/** Deal-in animation: per-card stagger and slide/fade duration. */
export const DEAL_STAGGER_MS = 80;
export const DEAL_DURATION_MS = 250;
/** Initial vertical offset of a freshly dealt card before it slides in. */
export const DEAL_SLIDE_OFFSET = -20;
/** How long the "newly dealt" marker survives (covers the full stagger). */
export const DEAL_MARK_CLEAR_MS = 800;

/** Half-turn flip when a card goes face-down → face-up. */
export const FLIP_DURATION_MS = 400;

const TABLE_COLORS: Readonly<Record<string, string>> = {
  felt_green: colors.tableBg,
  wood: colors.tableBg,
  dark: colors.tableBg,
};

// ─── Zone Grouping ─────────────────────────────────────────────────

export type ZoneEntry = readonly [string, ZoneState];

/** Checks if a zone name follows the per-player pattern (e.g., "hand:0"). */
export function isPlayerZone(name: string): boolean {
  return /:\d+$/.test(name);
}

/** Returns shared (non-player-owned) zone entries. */
export function getSharedZones(engineState: CardGameState): readonly ZoneEntry[] {
  return Object.entries(engineState.zones).filter(([name]) => !isPlayerZone(name));
}

/**
 * Determines whether a zone should render face-up on the shared god-view.
 * A zone is "public on the table" when its effective visibility (honoring
 * phase overrides) is `public` — the whole table is meant to see it, so we
 * reveal it here even if individual cards were dealt face-down.
 */
export function isPublicOnTable(engineState: CardGameState, zoneName: string): boolean {
  const baseName = zoneName.replace(/:\d+$/, "");
  const def = engineState.ruleset.zones.find((z) => z.name === baseName);
  if (!def) return false;
  const override = def.phaseOverrides?.find((o) => o.phase === engineState.currentPhase);
  const visibility = override?.visibility ?? def.visibility;
  return visibility.kind === "public";
}

export interface PlayerZoneGroup {
  readonly player: Player;
  readonly index: number;
  readonly zones: readonly ZoneEntry[];
  readonly isCurrentTurn: boolean;
  /** Score chip value, when the engine tracks a per-player score. */
  readonly score: number | null;
  /** Avatar initial: first character of the trimmed name, or "?". */
  readonly initial: string;
}

/** Groups per-player zones under their owning player. */
export function getPlayerZoneGroups(engineState: CardGameState): readonly PlayerZoneGroup[] {
  const groups: PlayerZoneGroup[] = [];

  for (let i = 0; i < engineState.players.length; i++) {
    const player = engineState.players[i]!;
    const playerSuffix = `:${i}`;
    const zones = Object.entries(engineState.zones).filter(([name]) => name.endsWith(playerSuffix));

    if (zones.length > 0) {
      const score = engineState.scores[`player_score:${i}`];
      groups.push({
        player,
        index: i,
        zones,
        isCurrentTurn: i === engineState.currentPlayerIndex,
        score: typeof score === "number" ? score : null,
        initial: player.name.trim().charAt(0).toUpperCase() || "?",
      });
    }
  }

  return groups;
}

// ─── Formatting ────────────────────────────────────────────────────

/** Formats a phase name for display: "player_turns" → "Player Turns" */
export function formatPhaseName(phase: string): string {
  return phase
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Formats a zone name for display: "draw_pile" → "Draw Pile", "hand:0" → "Hand" */
export function formatZoneName(name: string): string {
  const baseName = name.replace(/:\d+$/, "");
  return formatPhaseName(baseName);
}

/** Humanizes a snake_case key: "dealer_score" → "Dealer Score". */
function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolves a score key like "player_score:0" or "result:1" to a label. */
export function resolveScoreLabel(key: string, players: readonly Player[]): string {
  const playerMatch = key.match(/^player_score:(\d+)$/);
  if (playerMatch) {
    const player = players[Number(playerMatch[1])];
    return player?.name ?? key;
  }
  const resultMatch = key.match(/^result:(\d+)$/);
  if (resultMatch) {
    const player = players[Number(resultMatch[1])];
    return player ? `${player.name} (Result)` : key;
  }
  // Non-indexed keys like "dealer_score" — humanize
  return humanize(key);
}

/** Formats a status kind for display. */
export function formatStatusKind(kind: string): string {
  switch (kind) {
    case "waiting_for_players":
      return "Waiting for Players";
    case "in_progress":
      return "In Progress";
    case "paused":
      return "Paused";
    case "finished":
      return "Finished";
    default:
      return kind;
  }
}

/** Resolves the table background color from UI config. */
export function resolveTableColor(ui: UIConfig | undefined): string {
  if (!ui) return TABLE_COLORS.felt_green!;
  if (ui.tableColor === "custom" && ui.customColor) return ui.customColor;
  return TABLE_COLORS[ui.tableColor] ?? TABLE_COLORS.felt_green!;
}

// ─── Suits ─────────────────────────────────────────────────────────

/** Suit glyph for a suit name; unknown suits fall back to the raw name. */
export function suitSymbol(suit: string): string {
  return SUIT_SYMBOLS[suit] ?? suit;
}

export function isRedSuit(suit: string): boolean {
  return RED_SUITS.has(suit);
}

/** "hearts" → "Hearts" */
export function formatSuitName(suit: string): string {
  return suit.charAt(0).toUpperCase() + suit.slice(1);
}

export interface ActiveSuitModel {
  readonly suit: string;
  readonly symbol: string;
  readonly name: string;
  readonly color: string;
}

export function getActiveSuitModel(suit: string): ActiveSuitModel {
  return {
    suit,
    symbol: suitSymbol(suit),
    name: formatSuitName(suit),
    color: isRedSuit(suit) ? colors.suitRedBright : colors.text,
  };
}

/** Ink color for a face-up card: red suits vs. black. */
export function cardInkColor(card: Card): string {
  return isRedSuit(card.suit) ? colors.suitRed : colors.cardInk;
}

// ─── Status Bar ────────────────────────────────────────────────────

export interface StatusBarModel {
  readonly phaseLabel: string;
  readonly statusLabel: string;
  readonly currentPlayerName: string | null;
  readonly turnNumber: number;
}

export function getStatusBarModel(engineState: CardGameState): StatusBarModel {
  const currentPlayer = engineState.players[engineState.currentPlayerIndex] ?? null;
  return {
    phaseLabel: formatPhaseName(engineState.currentPhase),
    statusLabel: formatStatusKind(engineState.status.kind),
    currentPlayerName: currentPlayer?.name ?? null,
    turnNumber: engineState.turnNumber,
  };
}

// ─── Score Board ───────────────────────────────────────────────────

export interface ScoreRow {
  readonly key: string;
  readonly label: string;
  readonly score: number;
}

export function getScoreRows(engineState: CardGameState): readonly ScoreRow[] {
  return Object.entries(engineState.scores).map(([key, score]) => ({
    key,
    label: resolveScoreLabel(key, engineState.players),
    score,
  }));
}

// ─── Zone Display ──────────────────────────────────────────────────

/** Cards as the god-view shows them: forced face-up when the zone is revealed. */
export function revealCards(cards: readonly Card[], revealed: boolean): readonly Card[] {
  return revealed ? cards.map((card) => (card.faceUp ? card : { ...card, faceUp: true })) : cards;
}

export type ZoneDisplayMode =
  /** No cards: dashed placeholder. */
  | "empty"
  /** The discard pile: top card face-up with a count badge. */
  | "discard"
  /** Large all-face-down pile: three stacked card backs. */
  | "stack"
  /** Large mixed pile, collapsed: top card plus "+N more". */
  | "top_only"
  /** Every card, capped at MAX_VISIBLE_CARDS. */
  | "fanned";

export interface ZoneDisplayInput {
  readonly name: string;
  readonly cards: readonly Card[];
  readonly revealed: boolean;
  readonly expanded: boolean;
}

export function getZoneDisplayMode({
  name,
  cards,
  revealed,
  expanded,
}: ZoneDisplayInput): ZoneDisplayMode {
  if (cards.length === 0) return "empty";
  if (name === "discard") return "discard";

  const allFaceDown = !revealed && cards.every((card) => !card.faceUp);
  if (allFaceDown && cards.length > STACK_COLLAPSE_THRESHOLD) return "stack";

  const hasFaceUpCards = cards.some((c) => c.faceUp);
  const shouldShowTopOnly =
    !revealed &&
    !allFaceDown &&
    hasFaceUpCards &&
    cards.length > STACK_COLLAPSE_THRESHOLD &&
    !expanded;
  if (shouldShowTopOnly) return "top_only";

  return "fanned";
}

/**
 * Tracks the start index of freshly added cards between renders.
 * Returns the new marker given the previous and current card counts.
 */
export function nextNewCardStartIndex(
  prevCount: number,
  nextCount: number,
  currentMarker: number,
): number {
  if (nextCount > prevCount) return prevCount; // cards were added
  if (nextCount !== prevCount) return -1; // cards were removed
  return currentMarker;
}

export interface CappedCard {
  readonly card: Card;
  /** True when the card was just dealt and should animate in. */
  readonly isNew: boolean;
  /** Stagger delay in ms for the deal-in animation (0 for old cards). */
  readonly dealDelay: number;
}

export interface CappedCardList {
  /** Number of cards hidden behind the "+N more" indicator (0 when none). */
  readonly hiddenCount: number;
  readonly cards: readonly CappedCard[];
}

/** Caps a fanned zone at MAX_VISIBLE_CARDS and flags newly dealt cards. */
export function getCappedCardList(
  cards: readonly Card[],
  newCardStartIndex: number,
): CappedCardList {
  const hiddenCount = Math.max(0, cards.length - MAX_VISIBLE_CARDS);
  const visibleCards = hiddenCount > 0 ? cards.slice(-MAX_VISIBLE_CARDS) : cards;

  return {
    hiddenCount,
    cards: visibleCards.map((card, i) => {
      const globalIndex = hiddenCount + i;
      const isNew = newCardStartIndex >= 0 && globalIndex >= newCardStartIndex;
      return {
        card,
        isNew,
        dealDelay: isNew ? (globalIndex - newCardStartIndex) * DEAL_STAGGER_MS : 0,
      };
    }),
  };
}

// ─── Results Overlay ───────────────────────────────────────────────

export interface PlayerResultRow {
  readonly playerId: string;
  readonly name: string;
  readonly handValue: number;
  readonly resultLabel: "WIN" | "LOSS" | "DRAW";
  readonly resultColor: string;
}

export interface NpcScoreRow {
  readonly label: string;
  readonly score: number;
}

export type ResultsOverlayModel =
  | {
      readonly kind: "round_end";
      readonly players: readonly PlayerResultRow[];
      readonly npcScores: readonly NpcScoreRow[];
    }
  | { readonly kind: "finished"; readonly winnerName: string | null };

export function getPlayerResultRows(engineState: CardGameState): readonly PlayerResultRow[] {
  return engineState.players.map((player, index) => {
    const handValue = engineState.scores[`player_score:${index}`] ?? 0;
    const result = engineState.scores[`result:${index}`] ?? 0;
    return {
      playerId: player.id,
      name: player.name,
      handValue,
      resultLabel: result > 0 ? "WIN" : result < 0 ? "LOSS" : "DRAW",
      resultColor: result > 0 ? colors.success : result < 0 ? colors.redAlt : colors.amber,
    };
  });
}

/** Non-player "*_score" entries (e.g. "dealer_score" → "Dealer"). */
export function getNpcScores(engineState: CardGameState): readonly NpcScoreRow[] {
  return Object.entries(engineState.scores)
    .filter(([key]) => key.endsWith("_score") && !key.startsWith("player_score:"))
    .map(([key, value]) => ({ label: humanize(key.replace(/_score$/, "")), score: value }));
}

/** Name of the winning player when the game is finished, else null. */
export function resolveWinnerName(engineState: CardGameState): string | null {
  if (engineState.status.kind !== "finished") return null;
  const { winnerId } = engineState.status as { readonly winnerId: string | null };
  const winner = winnerId ? engineState.players.find((p) => p.id === winnerId) : null;
  return winner?.name ?? null;
}

/**
 * Overlay to show, if any. Round-end takes precedence over finished so a
 * round summary is never hidden by the game-over card.
 */
export function getResultsOverlayModel(engineState: CardGameState): ResultsOverlayModel | null {
  if (engineState.currentPhase === "round_end") {
    return {
      kind: "round_end",
      players: getPlayerResultRows(engineState),
      npcScores: getNpcScores(engineState),
    };
  }
  if (engineState.status.kind === "finished") {
    return { kind: "finished", winnerName: resolveWinnerName(engineState) };
  }
  return null;
}
