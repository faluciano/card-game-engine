// ─── Builtin Functions ─────────────────────────────────────────────
// Registers all builtin functions that the expression evaluator needs.
// Split into query builtins (read state) and effect builtins (record
// state-changing effects for the interpreter to apply).

import {
  registerBuiltin,
  type BuiltinFunction,
  type EvalResult,
  type EvalContext,
  ExpressionError,
} from "./expression-evaluator";
import type { CardGameState, Card, CardValue, ZoneState } from "../types/index";
import { isHumanPlayer } from "./role-utils";

// ─── Effect Types ──────────────────────────────────────────────────

/**
 * A description of a state-changing effect recorded by effect builtins.
 * The interpreter (task 1.14) applies these to produce new state.
 */
export interface EffectDescription {
  readonly kind: string;
  readonly params: Record<string, unknown>;
}

/**
 * Extended evaluation context with a mutable effects array.
 * Effect builtins push onto `effects`; query builtins only read `state`.
 */
export interface MutableEvalContext extends EvalContext {
  /** Mutable array reference — builtins push effect descriptions here. */
  readonly effects: EffectDescription[];

  /**
   * Optional callback that applies accumulated effects to state.
   * Used by the `while()` special form to flush effects between iterations
   * so the condition re-evaluation sees the updated state.
   *
   * Provided by the interpreter when executing automatic phases.
   */
  readonly applyEffectsToState?: (
    state: CardGameState,
    effects: EffectDescription[]
  ) => CardGameState;

  /** Parameters passed from a declare action, readable via the get_param() builtin. */
  readonly actionParams?: Readonly<Record<string, string | number | boolean>>;
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Extracts a zone name string from an EvalResult argument.
 * Accepts string results or number results (converted to string).
 */
function resolveZoneName(arg: EvalResult): string {
  if (arg.kind === "string") {
    return arg.value;
  }
  if (arg.kind === "number") {
    return String(arg.value);
  }
  throw new ExpressionError(
    `Expected zone name (string), got ${arg.kind}`
  );
}

/**
 * Looks up a zone by name in the game state.
 * Throws if the zone does not exist.
 */
function getZone(state: CardGameState, name: string): ZoneState {
  const zone = state.zones[name];
  if (!zone) {
    throw new ExpressionError(`Unknown zone: '${name}'`);
  }
  return zone;
}

/**
 * Looks up the CardValue definition for a given card rank.
 * Falls back to checking the rank string directly in cardValues.
 */
function getCardValue(
  cardValues: Readonly<Record<string, CardValue>>,
  rank: string
): CardValue {
  const cv = cardValues[rank];
  if (!cv) {
    throw new ExpressionError(`No card value defined for rank '${rank}'`);
  }
  return cv;
}

/**
 * Pushes an effect description onto the context's effects array.
 * Throws if the context does not support effects.
 */
function pushEffect(context: EvalContext, effect: EffectDescription): void {
  const mctx = context as MutableEvalContext;
  if (!mctx.effects || !Array.isArray(mctx.effects)) {
    throw new ExpressionError(
      `Effect builtin '${effect.kind}' requires a MutableEvalContext with an effects array`
    );
  }
  mctx.effects.push(effect);
}

/**
 * Extracts a required numeric argument from an EvalResult.
 */
function requireNumber(arg: EvalResult, name: string): number {
  if (arg.kind !== "number") {
    throw new ExpressionError(
      `Expected number for '${name}', got ${arg.kind}`
    );
  }
  return arg.value;
}

/**
 * Extracts a required string argument from an EvalResult.
 */
function requireString(arg: EvalResult, name: string): string {
  if (arg.kind !== "string") {
    throw new ExpressionError(
      `Expected string for '${name}', got ${arg.kind}`
    );
  }
  return arg.value;
}

/**
 * Extracts a required boolean argument from an EvalResult.
 */
function requireBoolean(arg: EvalResult, name: string): boolean {
  if (arg.kind !== "boolean") {
    throw new ExpressionError(
      `Expected boolean for '${name}', got ${arg.kind}`
    );
  }
  return arg.value;
}

/**
 * Validates that the correct number of arguments were passed.
 */
function assertArgCount(
  fnName: string,
  args: readonly EvalResult[],
  expected: number
): void {
  if (args.length !== expected) {
    throw new ExpressionError(
      `${fnName}() requires exactly ${expected} argument(s), got ${args.length}`
    );
  }
}

// ─── Pattern Matching Helpers ──────────────────────────────────────

/**
 * Groups cards in a zone by rank. Returns a map of rank → card count.
 */
function groupByRank(cards: readonly Card[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const card of cards) {
    groups.set(card.rank, (groups.get(card.rank) ?? 0) + 1);
  }
  return groups;
}

/**
 * Groups cards in a zone by suit. Returns a map of suit → card count.
 */
function groupBySuit(cards: readonly Card[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const card of cards) {
    groups.set(card.suit, (groups.get(card.suit) ?? 0) + 1);
  }
  return groups;
}

/**
 * Gets the numeric value of a card for ordering purposes.
 * For fixed-value cards, returns the value.
 * For dual-value cards (e.g., Ace), returns BOTH positions as an array.
 * This enables Ace to be both low (1) and high (14 or whatever high is) in straights.
 */
function getCardNumericValues(
  rank: string,
  cardValues: Readonly<Record<string, CardValue>>
): number[] {
  const cv = cardValues[rank];
  if (!cv) return [];
  if (cv.kind === "fixed") return [cv.value];
  // Dual-value: return both positions for straight detection
  return [cv.low, cv.high];
}

/**
 * Finds all consecutive runs in a sorted set of unique numeric values.
 * Returns an array of run lengths.
 *
 * Example: [1, 2, 3, 7, 8] → [3, 2] (run of 3 and run of 2)
 */
function findConsecutiveRuns(sortedValues: number[]): number[] {
  if (sortedValues.length === 0) return [];

  const runs: number[] = [];
  let currentRun = 1;

  for (let i = 1; i < sortedValues.length; i++) {
    if (sortedValues[i] === sortedValues[i - 1]! + 1) {
      currentRun++;
    } else {
      runs.push(currentRun);
      currentRun = 1;
    }
  }
  runs.push(currentRun);

  return runs;
}

// ─── Blackjack Hand Value Computation ──────────────────────────────

/**
 * Computes the optimal hand value for a set of cards, given a target
 * threshold (e.g., 21 for blackjack).
 *
 * For dual-value cards (Aces), all start at their high value. If the
 * total exceeds `target`, aces are downgraded one at a time to their
 * low value until the total is at or below `target`, or all aces have
 * been downgraded.
 *
 * @param cards - The cards in the hand.
 * @param cardValues - The value definitions from the ruleset.
 * @param target - The bust threshold (21 for blackjack).
 * @returns The optimal hand value.
 */
export function computeHandValue(
  cards: readonly Card[],
  cardValues: Readonly<Record<string, CardValue>>,
  target: number
): number {
  let total = 0;
  let dualCardCount = 0;
  let dualHighMinusLow = 0;

  for (const card of cards) {
    const cv = getCardValue(cardValues, card.rank);
    if (cv.kind === "fixed") {
      total += cv.value;
    } else {
      // Start with high value; track how many duals and the delta
      total += cv.high;
      dualCardCount++;
      dualHighMinusLow = cv.high - cv.low; // Same delta for all aces in standard blackjack
    }
  }

  // Downgrade dual-value cards one at a time while over target
  let remainingDowngrades = dualCardCount;
  while (total > target && remainingDowngrades > 0) {
    total -= dualHighMinusLow;
    remainingDowngrades--;
  }

  return total;
}

// ─── Query Builtins ────────────────────────────────────────────────

/**
 * hand_value(zone_ref) or hand_value(zone_ref, target) — Computes hand value.
 * With 1 arg: uses target=21 for backward compatibility.
 * With 2 args: uses the provided target for dual-value card downgrading.
 */
const handValueBuiltin: BuiltinFunction = (args, context) => {
  if (args.length < 1 || args.length > 2) {
    throw new ExpressionError(
      `hand_value() requires 1-2 arguments, got ${args.length}`
    );
  }
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;
  const target = args.length === 2 ? requireNumber(args[1]!, "target") : 21;
  const value = computeHandValue(zone.cards, cardValues, target);
  return { kind: "number", value };
};

/**
 * card_count(zone_ref) — Returns the number of cards in a zone.
 */
const cardCountBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("card_count", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  return { kind: "number", value: zone.cards.length };
};

/**
 * all_players_done() — Checks whether all human players have ended their
 * turns this phase by comparing `turnsTakenThisPhase` against the number
 * of human players.  `turnsTakenThisPhase` is incremented by the
 * `end_turn` effect and reset when the phase changes.
 */
const allPlayersDoneBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `all_players_done() takes no arguments, got ${args.length}`
    );
  }
  const { state } = context;
  const humanPlayerCount = state.players.filter(
    (p) => isHumanPlayer(p, state.ruleset.roles)
  ).length;
  return {
    kind: "boolean",
    value: state.turnsTakenThisPhase >= humanPlayerCount,
  };
};

/**
 * all_hands_dealt() — Sentinel: returns true.
 * The deal automatic sequence handles this.
 */
const allHandsDealtBuiltin: BuiltinFunction = (args, _context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `all_hands_dealt() takes no arguments, got ${args.length}`
    );
  }
  return { kind: "boolean", value: true };
};

/**
 * scores_calculated() — Sentinel: returns true.
 */
const scoresCalculatedBuiltin: BuiltinFunction = (args, _context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `scores_calculated() takes no arguments, got ${args.length}`
    );
  }
  return { kind: "boolean", value: true };
};

/**
 * continue_game() — Sentinel: returns true (game continues by default).
 */
const continueGameBuiltin: BuiltinFunction = (args, _context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `continue_game() takes no arguments, got ${args.length}`
    );
  }
  return { kind: "boolean", value: true };
};

/**
 * sum_card_values(zone_ref, strategy) — Computes card values with strategy.
 * The strategy is a number (target threshold from prefer_high_under).
 */
const sumCardValuesBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("sum_card_values", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const target = requireNumber(args[1]!, "strategy");
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;
  const value = computeHandValue(zone.cards, cardValues, target);
  return { kind: "number", value };
};

/**
 * prefer_high_under(target) — Returns a strategy descriptor (just the target number).
 */
const preferHighUnderBuiltin: BuiltinFunction = (args, _context) => {
  assertArgCount("prefer_high_under", args, 1);
  const target = requireNumber(args[0]!, "target");
  return { kind: "number", value: target };
};

/**
 * card_rank(zone, index) — Returns the numeric rank value of a card.
 * For dual-value cards (e.g., Ace), returns the high value.
 */
const cardRankBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("card_rank", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const index = requireNumber(args[1]!, "index");
  const zone = getZone(context.state, zoneName);
  if (index < 0 || index >= zone.cards.length) {
    throw new ExpressionError(
      `card_rank(): index ${index} out of bounds for zone '${zoneName}' (${zone.cards.length} cards)`
    );
  }
  const card = zone.cards[index]!;
  const cv = getCardValue(context.state.ruleset.deck.cardValues, card.rank);
  const value = cv.kind === "fixed" ? cv.value : cv.high;
  return { kind: "number", value };
};

/**
 * card_suit(zone, index) — Returns the suit string of a card.
 */
const cardSuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("card_suit", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const index = requireNumber(args[1]!, "index");
  const zone = getZone(context.state, zoneName);
  if (index < 0 || index >= zone.cards.length) {
    throw new ExpressionError(
      `card_suit(): index ${index} out of bounds for zone '${zoneName}' (${zone.cards.length} cards)`
    );
  }
  const card = zone.cards[index]!;
  return { kind: "string", value: card.suit };
};

/**
 * card_rank_name(zone, index) — Returns the rank string of a card (e.g., "A", "K", "7").
 */
const cardRankNameBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("card_rank_name", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const index = requireNumber(args[1]!, "index");
  const zone = getZone(context.state, zoneName);
  if (index < 0 || index >= zone.cards.length) {
    throw new ExpressionError(
      `card_rank_name(): index ${index} out of bounds for zone '${zoneName}' (${zone.cards.length} cards)`
    );
  }
  const card = zone.cards[index]!;
  return { kind: "string", value: card.rank };
};

/**
 * count_rank(zone, rank_name) — Counts cards in a zone with the given rank string.
 */
const countRankBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("count_rank", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const rankName = requireString(args[1]!, "rank_name");
  const zone = getZone(context.state, zoneName);
  const count = zone.cards.filter((card) => card.rank === rankName).length;
  return { kind: "number", value: count };
};

/**
 * top_card_rank(zone) — Returns the numeric rank of the first card in a zone.
 * Shorthand for card_rank(zone, 0).
 */
const topCardRankBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("top_card_rank", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  if (zone.cards.length === 0) {
    throw new ExpressionError(
      `top_card_rank(): zone '${zoneName}' is empty`
    );
  }
  const card = zone.cards[0]!;
  const cv = getCardValue(context.state.ruleset.deck.cardValues, card.rank);
  const value = cv.kind === "fixed" ? cv.value : cv.high;
  return { kind: "number", value };
};

/**
 * max_card_rank(zone) — Returns the highest numeric rank value in a zone.
 * Returns 0 for empty zones.
 */
const maxCardRankBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("max_card_rank", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  if (zone.cards.length === 0) {
    return { kind: "number", value: 0 };
  }
  const cardValues = context.state.ruleset.deck.cardValues;
  let max = -Infinity;
  for (const card of zone.cards) {
    const cv = getCardValue(cardValues, card.rank);
    const value = cv.kind === "fixed" ? cv.value : cv.high;
    if (value > max) {
      max = value;
    }
  }
  return { kind: "number", value: max };
};

/**
 * top_card_suit(zone) — Returns the suit string of the first card in a zone.
 */
const topCardSuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("top_card_suit", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  if (zone.cards.length === 0) {
    throw new ExpressionError(`top_card_suit(): zone '${zoneName}' is empty`);
  }
  return { kind: "string", value: zone.cards[0]!.suit };
};

/**
 * top_card_rank_name(zone) — Returns the rank string of the first card in a zone.
 */
const topCardRankNameBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("top_card_rank_name", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  if (zone.cards.length === 0) {
    throw new ExpressionError(
      `top_card_rank_name(): zone '${zoneName}' is empty`
    );
  }
  return { kind: "string", value: zone.cards[0]!.rank };
};

/**
 * has_card_matching_suit(zone, suit_string) — Returns boolean: does the zone
 * contain any card with the given suit?
 */
const hasCardMatchingSuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_card_matching_suit", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const suitName = requireString(args[1]!, "suit");
  const zone = getZone(context.state, zoneName);
  const found = zone.cards.some((card) => card.suit === suitName);
  return { kind: "boolean", value: found };
};

/**
 * has_card_matching_rank(zone, rank_string) — Returns boolean: does the zone
 * contain any card with the given rank?
 */
const hasCardMatchingRankBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_card_matching_rank", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const rankName = requireString(args[1]!, "rank");
  const zone = getZone(context.state, zoneName);
  const found = zone.cards.some((card) => card.rank === rankName);
  return { kind: "boolean", value: found };
};

/**
 * card_matches_top(hand_zone, card_index, target_zone) — Returns boolean:
 * does the card at `card_index` in `hand_zone` match the top card of
 * `target_zone` by suit OR rank?
 */
const cardMatchesTopBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("card_matches_top", args, 3);
  const handZoneName = resolveZoneName(args[0]!);
  const cardIndex = requireNumber(args[1]!, "card_index");
  const targetZoneName = resolveZoneName(args[2]!);
  const handZone = getZone(context.state, handZoneName);
  const targetZone = getZone(context.state, targetZoneName);
  if (cardIndex < 0 || cardIndex >= handZone.cards.length) {
    throw new ExpressionError(
      `card_matches_top(): index ${cardIndex} out of bounds for zone '${handZoneName}' (${handZone.cards.length} cards)`
    );
  }
  if (targetZone.cards.length === 0) {
    throw new ExpressionError(
      `card_matches_top(): target zone '${targetZoneName}' is empty`
    );
  }
  const card = handZone.cards[cardIndex]!;
  const topCard = targetZone.cards[0]!;
  return {
    kind: "boolean",
    value: card.suit === topCard.suit || card.rank === topCard.rank,
  };
};

/**
 * has_playable_card(hand_zone, target_zone) — Returns boolean: does the hand
 * contain any card that matches the top of the target zone by suit or rank?
 */
const hasPlayableCardBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_playable_card", args, 2);
  const handZoneName = resolveZoneName(args[0]!);
  const targetZoneName = resolveZoneName(args[1]!);
  const handZone = getZone(context.state, handZoneName);
  const targetZone = getZone(context.state, targetZoneName);
  if (targetZone.cards.length === 0) {
    return { kind: "boolean", value: false };
  }
  const topCard = targetZone.cards[0]!;
  const found = handZone.cards.some(
    (card) => card.suit === topCard.suit || card.rank === topCard.rank
  );
  return { kind: "boolean", value: found };
};

// ─── Effect Builtins ───────────────────────────────────────────────

/**
 * shuffle(zone_name) — Records a shuffle effect.
 */
const shuffleBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("shuffle", args, 1);
  const zone = resolveZoneName(args[0]!);
  pushEffect(context, { kind: "shuffle", params: { zone } });
};

/**
 * deal(from_zone, to_zone, count) — Records a deal effect.
 * Moves N cards from one zone to another for each player.
 */
const dealBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("deal", args, 3);
  const from = resolveZoneName(args[0]!);
  const to = resolveZoneName(args[1]!);
  const count = requireNumber(args[2]!, "count");
  pushEffect(context, { kind: "deal", params: { from, to, count } });
};

/**
 * draw(from_zone, to_zone, count) — Records a draw effect.
 * Moves N cards from one zone to another for the current player.
 */
const drawBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("draw", args, 3);
  const from = resolveZoneName(args[0]!);
  const to = resolveZoneName(args[1]!);
  const count = requireNumber(args[2]!, "count");
  pushEffect(context, { kind: "draw", params: { from, to, count } });
};

/**
 * set_face_up(zone_name, card_index, face_up) — Records a set_face_up effect.
 */
const setFaceUpBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("set_face_up", args, 3);
  const zone = resolveZoneName(args[0]!);
  const cardIndex = requireNumber(args[1]!, "card_index");
  const faceUp = requireBoolean(args[2]!, "face_up");
  pushEffect(context, { kind: "set_face_up", params: { zone, cardIndex, faceUp } });
};

/**
 * reveal_all(zone_name) — Records a reveal_all effect.
 */
const revealAllBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("reveal_all", args, 1);
  const zone = resolveZoneName(args[0]!);
  pushEffect(context, { kind: "reveal_all", params: { zone } });
};

/**
 * end_turn() — Records an end_turn effect.
 */
const endTurnBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `end_turn() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "end_turn", params: {} });
};

/**
 * calculate_scores() — Records a calculate_scores effect.
 */
const calculateScoresBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `calculate_scores() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "calculate_scores", params: {} });
};

/**
 * determine_winners() — Records a determine_winners effect.
 */
const determineWinnersBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `determine_winners() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "determine_winners", params: {} });
};

/**
 * collect_all_to(zone_name) — Records a collect_all_to effect.
 */
const collectAllToBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("collect_all_to", args, 1);
  const zone = resolveZoneName(args[0]!);
  pushEffect(context, { kind: "collect_all_to", params: { zone } });
};

/**
 * reset_round() — Records a reset_round effect.
 */
const resetRoundBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `reset_round() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "reset_round", params: {} });
};

/**
 * move_top(from, to, count) — Records a move_top effect.
 * Moves top N cards from one zone to another.
 */
const moveTopBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("move_top", args, 3);
  const from = resolveZoneName(args[0]!);
  const to = resolveZoneName(args[1]!);
  const count = requireNumber(args[2]!, "count");
  pushEffect(context, { kind: "move_top", params: { from, to, count } });
};

/**
 * flip_top(zone, count) — Records a flip_top effect.
 * Flips top N cards face-up in a zone.
 */
const flipTopBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("flip_top", args, 2);
  const zone = resolveZoneName(args[0]!);
  const count = requireNumber(args[1]!, "count");
  pushEffect(context, { kind: "flip_top", params: { zone, count } });
};

/**
 * move_all(from, to) — Records a move_all effect.
 * Moves ALL cards from one zone to another.
 */
const moveAllBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("move_all", args, 2);
  const from = resolveZoneName(args[0]!);
  const to = resolveZoneName(args[1]!);
  pushEffect(context, { kind: "move_all", params: { from, to } });
};

// ─── Turn Manipulation Builtins ────────────────────────────────────

/**
 * reverse_turn_order() — Records a reverse_turn_order effect.
 * Flips turn direction (clockwise ↔ counterclockwise).
 */
const reverseTurnOrderBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `reverse_turn_order() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "reverse_turn_order", params: {} });
};

/**
 * skip_next_player() — Records a skip_next_player effect.
 * Advances current player index by one step in the current direction.
 */
const skipNextPlayerBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `skip_next_player() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "skip_next_player", params: {} });
};

/**
 * set_next_player(index) — Records a set_next_player effect.
 * Sets the next player to a specific index.
 */
const setNextPlayerBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("set_next_player", args, 1);
  const playerIndex = requireNumber(args[0]!, "playerIndex");
  pushEffect(context, { kind: "set_next_player", params: { playerIndex } });
};

/**
 * turn_direction() — Returns the current turn direction as a number (1 or -1).
 */
const turnDirectionBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `turn_direction() takes no arguments, got ${args.length}`
    );
  }
  return { kind: "number", value: context.state.turnDirection };
};

// ─── Custom Variable Builtins ──────────────────────────────────────

/**
 * get_var(name) — Returns the value of a custom variable.
 * Throws if the variable does not exist.
 */
const getVarBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("get_var", args, 1);
  const name = requireString(args[0]!, "name");
  const value = context.state.variables[name];
  if (value === undefined) {
    throw new ExpressionError(`get_var: variable '${name}' not found`);
  }
  return { kind: "number", value };
};

/**
 * get_param(name) — Returns the value of an action parameter.
 * Reads from the actionParams context provided by a declare action.
 * Returns 0 if the param doesn't exist or actionParams is undefined.
 * Booleans are returned as 1 (true) or 0 (false).
 */
const getParamBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("get_param", args, 1);
  const name = requireString(args[0]!, "name");
  const params = context.actionParams;
  if (!params || !(name in params)) {
    return { kind: "number", value: 0 };
  }
  const value = params[name]!;
  if (typeof value === "boolean") {
    return { kind: "number", value: value ? 1 : 0 };
  }
  if (typeof value === "number") {
    return { kind: "number", value };
  }
  return { kind: "string", value };
};

// ─── Pattern Matching Query Builtins ───────────────────────────────

/**
 * count_sets(zone, min_size) — Count groups of cards with the same rank
 * that have at least `min_size` cards.
 */
const countSetsBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("count_sets", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const minSize = requireNumber(args[1]!, "min_size");
  const zone = getZone(context.state, zoneName);
  const groups = groupByRank(zone.cards);
  let count = 0;
  for (const size of groups.values()) {
    if (size >= minSize) count++;
  }
  return { kind: "number", value: count };
};

/**
 * max_set_size(zone) — Size of the largest rank group
 * (e.g., 4 for four-of-a-kind).
 */
const maxSetSizeBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("max_set_size", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  const groups = groupByRank(zone.cards);
  let max = 0;
  for (const size of groups.values()) {
    if (size > max) max = size;
  }
  return { kind: "number", value: max };
};

/**
 * has_flush(zone, min_size) — True if any suit has at least `min_size`
 * cards in the zone.
 */
const hasFlushBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_flush", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const minSize = requireNumber(args[1]!, "min_size");
  const zone = getZone(context.state, zoneName);
  const groups = groupBySuit(zone.cards);
  for (const size of groups.values()) {
    if (size >= minSize) return { kind: "boolean", value: true };
  }
  return { kind: "boolean", value: false };
};

/**
 * has_straight(zone, length) — True if there's a consecutive sequence
 * of ranks of the given length. Uses `cardValues` from ruleset for
 * rank ordering.
 */
const hasStraightBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_straight", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const length = requireNumber(args[1]!, "length");
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;

  // Collect all unique numeric positions for ranks present in the zone
  const valueSet = new Set<number>();
  for (const card of zone.cards) {
    for (const v of getCardNumericValues(card.rank, cardValues)) {
      valueSet.add(v);
    }
  }

  const sorted = [...valueSet].sort((a, b) => a - b);
  const runs = findConsecutiveRuns(sorted);
  return { kind: "boolean", value: runs.some((r) => r >= length) };
};

/**
 * count_runs(zone, min_length) — Count distinct consecutive rank
 * sequences of at least `min_length`.
 */
const countRunsBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("count_runs", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const minLength = requireNumber(args[1]!, "min_length");
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;

  const valueSet = new Set<number>();
  for (const card of zone.cards) {
    for (const v of getCardNumericValues(card.rank, cardValues)) {
      valueSet.add(v);
    }
  }

  const sorted = [...valueSet].sort((a, b) => a - b);
  const runs = findConsecutiveRuns(sorted);
  return { kind: "number", value: runs.filter((r) => r >= minLength).length };
};

/**
 * max_run_length(zone) — Length of the longest consecutive rank sequence.
 */
const maxRunLengthBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("max_run_length", args, 1);
  const zoneName = resolveZoneName(args[0]!);
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;

  const valueSet = new Set<number>();
  for (const card of zone.cards) {
    for (const v of getCardNumericValues(card.rank, cardValues)) {
      valueSet.add(v);
    }
  }

  const sorted = [...valueSet].sort((a, b) => a - b);
  const runs = findConsecutiveRuns(sorted);
  return { kind: "number", value: runs.length > 0 ? Math.max(...runs) : 0 };
};

// ─── Trick-Taking Query Builtins ───────────────────────────────────

/**
 * Resolves the numeric value of a card's rank for trick comparison.
 * For fixed values, returns `value`. For dual values, returns `high`
 * (trick-taking always uses the high value).
 */
function resolveCardRankValue(
  cardValues: Readonly<Record<string, CardValue>>,
  rank: string
): number {
  const cv = getCardValue(cardValues, rank);
  return cv.kind === "fixed" ? cv.value : cv.high;
}

/**
 * trick_winner(zone_prefix) — Determines the winner of a trick.
 * Compares face-up cards across all `{prefix}:{N}` zones.
 * The led suit comes from the card in `{prefix}:{lead_player}`.
 * If a `trump_suit` variable is set and any player played that suit,
 * the highest trump wins. Otherwise, highest led-suit card wins.
 * Returns -1 if no valid cards found.
 */
const trickWinnerBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("trick_winner", args, 1);
  const prefix = requireString(args[0]!, "zone_prefix");
  const { state } = context;
  const playerCount = state.players.length;
  const cardValues = state.ruleset.deck.cardValues;

  const leadPlayer = state.variables.lead_player;
  if (leadPlayer === undefined) {
    return { kind: "number", value: -1 };
  }

  // Resolve led suit from the lead player's trick zone
  const leadZoneName = `${prefix}:${leadPlayer}`;
  const leadZone = state.zones[leadZoneName];
  if (!leadZone || leadZone.cards.length === 0) {
    return { kind: "number", value: -1 };
  }
  const ledSuit = leadZone.cards[0]!.suit;

  // Check for trump suit
  const trumpSuit =
    state.variables.trump_suit !== undefined
      ? String(state.variables.trump_suit)
      : undefined;

  // Collect all player cards with their indices
  type TrickEntry = { playerIndex: number; card: Card };
  const entries: TrickEntry[] = [];
  for (let i = 0; i < playerCount; i++) {
    const zoneName = `${prefix}:${i}`;
    const zone = state.zones[zoneName];
    if (zone && zone.cards.length > 0) {
      entries.push({ playerIndex: i, card: zone.cards[0]! });
    }
  }

  if (entries.length === 0) {
    return { kind: "number", value: -1 };
  }

  // If trump suit exists and any player played it, trumps beat all
  let trumpEntries: TrickEntry[] = [];
  if (trumpSuit !== undefined) {
    trumpEntries = entries.filter((e) => e.card.suit === trumpSuit);
  }

  if (trumpEntries.length > 0) {
    // Highest trump wins
    let best = trumpEntries[0]!;
    for (let i = 1; i < trumpEntries.length; i++) {
      const entry = trumpEntries[i]!;
      if (
        resolveCardRankValue(cardValues, entry.card.rank) >
        resolveCardRankValue(cardValues, best.card.rank)
      ) {
        best = entry;
      }
    }
    return { kind: "number", value: best.playerIndex };
  }

  // No trumps — highest card in the led suit wins
  const ledSuitEntries = entries.filter((e) => e.card.suit === ledSuit);
  if (ledSuitEntries.length === 0) {
    return { kind: "number", value: -1 };
  }

  let best = ledSuitEntries[0]!;
  for (let i = 1; i < ledSuitEntries.length; i++) {
    const entry = ledSuitEntries[i]!;
    if (
      resolveCardRankValue(cardValues, entry.card.rank) >
      resolveCardRankValue(cardValues, best.card.rank)
    ) {
      best = entry;
    }
  }
  return { kind: "number", value: best.playerIndex };
};

/**
 * led_card_suit(zone_prefix) — Returns the suit of the card played by
 * the lead player. Reads `lead_player` from variables. Returns empty
 * string if the zone is empty or lead_player is not set.
 */
const ledCardSuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("led_card_suit", args, 1);
  const prefix = requireString(args[0]!, "zone_prefix");
  const { state } = context;

  const leadPlayer = state.variables.lead_player;
  if (leadPlayer === undefined) {
    return { kind: "string", value: "" };
  }

  const zoneName = `${prefix}:${leadPlayer}`;
  const zone = state.zones[zoneName];
  if (!zone || zone.cards.length === 0) {
    return { kind: "string", value: "" };
  }

  return { kind: "string", value: zone.cards[0]!.suit };
};

/**
 * trick_card_count(zone_prefix) — Returns the total number of cards
 * across all `{prefix}:{N}` zones. Used to detect "trick complete"
 * (count == player_count).
 */
const trickCardCountBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("trick_card_count", args, 1);
  const prefix = requireString(args[0]!, "zone_prefix");
  const { state } = context;
  const playerCount = state.players.length;

  let total = 0;
  for (let i = 0; i < playerCount; i++) {
    const zoneName = `${prefix}:${i}`;
    const zone = state.zones[zoneName];
    if (zone) {
      total += zone.cards.length;
    }
  }
  return { kind: "number", value: total };
};

/**
 * count_cards_by_suit(zone, suit) — Counts cards of a specific suit
 * in a zone. E.g., `count_cards_by_suit("won:0", "hearts")`.
 */
const countCardsBySuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("count_cards_by_suit", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const suit = requireString(args[1]!, "suit");
  const zone = getZone(context.state, zoneName);
  const count = zone.cards.filter((card) => card.suit === suit).length;
  return { kind: "number", value: count };
};

/**
 * has_card_with(zone, rank, suit) — Returns boolean: does the zone
 * contain a card matching both the specified rank AND suit?
 * Used for Q♠ detection in Hearts.
 */
const hasCardWithBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("has_card_with", args, 3);
  const zoneName = resolveZoneName(args[0]!);
  const rank = requireString(args[1]!, "rank");
  const suit = requireString(args[2]!, "suit");
  const zone = getZone(context.state, zoneName);
  const found = zone.cards.some(
    (card) => card.rank === rank && card.suit === suit
  );
  return { kind: "boolean", value: found };
};

/**
 * sum_zone_values_by_suit(zone, suit) — Sums card values for cards
 * of a specific suit. Uses `cardValues` from the ruleset.
 * For dual-value cards, uses the `high` value.
 */
const sumZoneValuesBySuitBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("sum_zone_values_by_suit", args, 2);
  const zoneName = resolveZoneName(args[0]!);
  const suit = requireString(args[1]!, "suit");
  const zone = getZone(context.state, zoneName);
  const cardValues = context.state.ruleset.deck.cardValues;
  let total = 0;
  for (const card of zone.cards) {
    if (card.suit === suit) {
      total += resolveCardRankValue(cardValues, card.rank);
    }
  }
  return { kind: "number", value: total };
};

// ─── Trick-Taking Effect Builtins ──────────────────────────────────

/**
 * collect_trick(zone_prefix, target_zone) — Records a collect_trick effect.
 * Moves all cards from every `{prefix}:{N}` zone into the target zone,
 * setting them face-down.
 */
const collectTrickBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("collect_trick", args, 2);
  const zonePrefix = requireString(args[0]!, "zone_prefix");
  const targetZone = resolveZoneName(args[1]!);
  pushEffect(context, {
    kind: "collect_trick",
    params: { zonePrefix, targetZone },
  });
};

/**
 * set_lead_player(player_index) — Records a set_lead_player effect.
 * Sets `variables.lead_player` AND `currentPlayerIndex` to the given index.
 */
const setLeadPlayerBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("set_lead_player", args, 1);
  const playerIndex = requireNumber(args[0]!, "player_index");
  pushEffect(context, {
    kind: "set_lead_player",
    params: { playerIndex },
  });
};

/**
 * end_game() — Records an end_game effect.
 * Transitions the game status to `{ kind: "finished" }`.
 */
const endGameBuiltin: BuiltinFunction = (args, context) => {
  if (args.length !== 0) {
    throw new ExpressionError(
      `end_game() takes no arguments, got ${args.length}`
    );
  }
  pushEffect(context, { kind: "end_game", params: {} });
};

/**
 * set_var(name, value) — Records a set_var effect.
 * Sets a custom variable to the given numeric value.
 */
const setVarBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("set_var", args, 2);
  const name = requireString(args[0]!, "name");
  const value = requireNumber(args[1]!, "value");
  pushEffect(context, { kind: "set_var", params: { name, value } });
};

/**
 * inc_var(name, amount) — Records an inc_var effect.
 * Increments a custom variable by the given amount (can be negative).
 */
const incVarBuiltin: BuiltinFunction = (args, context) => {
  assertArgCount("inc_var", args, 2);
  const name = requireString(args[0]!, "name");
  const amount = requireNumber(args[1]!, "amount");
  pushEffect(context, { kind: "inc_var", params: { name, amount } });
};

// ─── String Builtins ───────────────────────────────────────────────

/**
 * concat(a, b) — Concatenates two values into a string.
 * Both arguments are coerced to strings: numbers become their decimal
 * representation, strings are used as-is, booleans become "true"/"false".
 */
const concatBuiltin: BuiltinFunction = (args, _context) => {
  assertArgCount("concat", args, 2);
  const a = coerceToString(args[0]!);
  const b = coerceToString(args[1]!);
  return { kind: "string", value: a + b };
};

/**
 * Coerces an EvalResult to a string for concat operations.
 */
function coerceToString(arg: EvalResult): string {
  switch (arg.kind) {
    case "string":
      return arg.value;
    case "number":
      return String(arg.value);
    case "boolean":
      return String(arg.value);
    default:
      throw new ExpressionError(
        `Cannot coerce ${arg.kind} to string`
      );
  }
}

// ─── Registration ──────────────────────────────────────────────────

/**
 * Registers all builtin functions with the expression evaluator.
 * Must be called before evaluating any expressions that reference builtins.
 *
 * Note: `while` is handled as a special form in the expression evaluator
 * itself (not registered here) because it requires lazy argument evaluation.
 */
export function registerAllBuiltins(): void {
  // Query builtins
  registerBuiltin("hand_value", handValueBuiltin);
  registerBuiltin("card_count", cardCountBuiltin);
  registerBuiltin("card_rank", cardRankBuiltin);
  registerBuiltin("card_rank_name", cardRankNameBuiltin);
  registerBuiltin("card_suit", cardSuitBuiltin);
  registerBuiltin("count_rank", countRankBuiltin);
  registerBuiltin("max_card_rank", maxCardRankBuiltin);
  registerBuiltin("top_card_rank", topCardRankBuiltin);
  registerBuiltin("top_card_suit", topCardSuitBuiltin);
  registerBuiltin("top_card_rank_name", topCardRankNameBuiltin);
  registerBuiltin("has_card_matching_suit", hasCardMatchingSuitBuiltin);
  registerBuiltin("has_card_matching_rank", hasCardMatchingRankBuiltin);
  registerBuiltin("card_matches_top", cardMatchesTopBuiltin);
  registerBuiltin("has_playable_card", hasPlayableCardBuiltin);
  registerBuiltin("all_players_done", allPlayersDoneBuiltin);
  registerBuiltin("all_hands_dealt", allHandsDealtBuiltin);
  registerBuiltin("scores_calculated", scoresCalculatedBuiltin);
  registerBuiltin("continue_game", continueGameBuiltin);
  registerBuiltin("sum_card_values", sumCardValuesBuiltin);
  registerBuiltin("prefer_high_under", preferHighUnderBuiltin);
  registerBuiltin("get_var", getVarBuiltin);
  registerBuiltin("get_param", getParamBuiltin);
  registerBuiltin("count_sets", countSetsBuiltin);
  registerBuiltin("max_set_size", maxSetSizeBuiltin);
  registerBuiltin("has_flush", hasFlushBuiltin);
  registerBuiltin("has_straight", hasStraightBuiltin);
  registerBuiltin("count_runs", countRunsBuiltin);
  registerBuiltin("max_run_length", maxRunLengthBuiltin);
  registerBuiltin("trick_winner", trickWinnerBuiltin);
  registerBuiltin("led_card_suit", ledCardSuitBuiltin);
  registerBuiltin("trick_card_count", trickCardCountBuiltin);
  registerBuiltin("count_cards_by_suit", countCardsBySuitBuiltin);
  registerBuiltin("has_card_with", hasCardWithBuiltin);
  registerBuiltin("sum_zone_values_by_suit", sumZoneValuesBySuitBuiltin);

  // String builtins
  registerBuiltin("concat", concatBuiltin);

  // Effect builtins
  registerBuiltin("shuffle", shuffleBuiltin);
  registerBuiltin("deal", dealBuiltin);
  registerBuiltin("draw", drawBuiltin);
  registerBuiltin("set_face_up", setFaceUpBuiltin);
  registerBuiltin("reveal_all", revealAllBuiltin);
  registerBuiltin("end_turn", endTurnBuiltin);
  registerBuiltin("calculate_scores", calculateScoresBuiltin);
  registerBuiltin("determine_winners", determineWinnersBuiltin);
  registerBuiltin("collect_all_to", collectAllToBuiltin);
  registerBuiltin("reset_round", resetRoundBuiltin);
  registerBuiltin("move_top", moveTopBuiltin);
  registerBuiltin("flip_top", flipTopBuiltin);
  registerBuiltin("move_all", moveAllBuiltin);
  registerBuiltin("reverse_turn_order", reverseTurnOrderBuiltin);
  registerBuiltin("skip_next_player", skipNextPlayerBuiltin);
  registerBuiltin("set_next_player", setNextPlayerBuiltin);
  registerBuiltin("collect_trick", collectTrickBuiltin);
  registerBuiltin("set_lead_player", setLeadPlayerBuiltin);
  registerBuiltin("end_game", endGameBuiltin);
  registerBuiltin("turn_direction", turnDirectionBuiltin);
  registerBuiltin("set_var", setVarBuiltin);
  registerBuiltin("inc_var", incVarBuiltin);
}
