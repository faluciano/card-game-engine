// ─── Ruleset Definition ────────────────────────────────────────────
// The complete, declarative schema for a card game.
// A .cardgame.json file is parsed into this type.
// Every section is readonly to enforce immutability after parse.

import type { CardValue, Rank, Suit, ZoneVisibility } from "./card";

// ─── Meta ──────────────────────────────────────────────────────────

export interface RulesetMeta {
  readonly name: string;
  readonly slug: string;
  readonly version: string;
  readonly author: string;
  readonly players: {
    readonly min: number;
    readonly max: number;
  };
}

// ─── Deck Configuration ────────────────────────────────────────────

/** Preset deck identifiers the engine knows how to build. */
export type DeckPreset = "standard_52" | "standard_54" | "uno_108";

export interface DeckConfig {
  readonly preset: DeckPreset;
  readonly copies: number;
  readonly cardValues: Readonly<Record<string, CardValue>>;
}

// ─── Zone Configuration ────────────────────────────────────────────

export interface ZoneConfig {
  readonly name: string;
  readonly visibility: ZoneVisibility;
  readonly owners: readonly string[];
  readonly maxCards?: number;
}

// ─── Roles ─────────────────────────────────────────────────────────

export interface RoleDefinition {
  readonly name: string;
  readonly isHuman: boolean;
  readonly count: number | "per_player";
}

// ─── Phases ────────────────────────────────────────────────────────

/**
 * Phase advancement model — discriminated on `kind`.
 *
 * - `automatic`:   engine advances after executing a sequence of actions
 * - `turn_based`:  players take turns choosing from allowed actions
 * - `all_players`: all players act simultaneously (e.g., reveal phase)
 */
export type PhaseKind = "automatic" | "turn_based" | "all_players";

export interface PhaseAction {
  readonly name: string;
  readonly label: string;
  readonly condition?: Expression;
  readonly effect: readonly Expression[];
}

export interface PhaseDefinition {
  readonly name: string;
  readonly kind: PhaseKind;
  readonly actions: readonly PhaseAction[];
  readonly transitions: readonly PhaseTransition[];
  /** For automatic phases: the sequence to execute. */
  readonly automaticSequence?: readonly Expression[];
  /** For turn_based phases: how turn order advances. */
  readonly turnOrder?: "clockwise" | "counterclockwise" | "fixed";
}

export interface PhaseTransition {
  readonly to: string;
  readonly when: Expression;
}

// ─── Expression DSL ────────────────────────────────────────────────

/**
 * A safe expression in the ruleset DSL.
 * Can be a simple string expression or a structured operation.
 * The ExpressionEvaluator interprets these at runtime.
 */
export type Expression = string;

// ─── Scoring ───────────────────────────────────────────────────────

export interface ScoringConfig {
  readonly method: Expression;
  readonly winCondition: Expression;
  readonly bustCondition?: Expression;
  readonly tieCondition?: Expression;
  readonly autoEndTurnCondition?: Expression;
}

// ─── Visibility Rules ──────────────────────────────────────────────

export interface VisibilityRule {
  readonly zone: string;
  readonly visibility: ZoneVisibility;
  /** Override visibility in a specific phase. */
  readonly phaseOverride?: {
    readonly phase: string;
    readonly visibility: ZoneVisibility;
  };
}

// ─── UI Hints ──────────────────────────────────────────────────────

export type TableLayout = "semicircle" | "circle" | "grid" | "linear";
export type TableColor = "felt_green" | "wood" | "dark" | "custom";

export interface UIConfig {
  readonly layout: TableLayout;
  readonly tableColor: TableColor;
  readonly customColor?: string;
}

// ─── Complete Ruleset ──────────────────────────────────────────────

/**
 * The top-level type for a fully parsed .cardgame.json file.
 * Immutable by design — the engine never mutates a ruleset.
 */
export interface CardGameRuleset {
  readonly meta: RulesetMeta;
  readonly deck: DeckConfig;
  readonly zones: readonly ZoneConfig[];
  readonly roles: readonly RoleDefinition[];
  readonly phases: readonly PhaseDefinition[];
  readonly scoring: ScoringConfig;
  readonly visibility: readonly VisibilityRule[];
  readonly ui: UIConfig;
}
