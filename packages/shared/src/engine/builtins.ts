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
  registerBuiltin("all_players_done", allPlayersDoneBuiltin);
  registerBuiltin("all_hands_dealt", allHandsDealtBuiltin);
  registerBuiltin("scores_calculated", scoresCalculatedBuiltin);
  registerBuiltin("continue_game", continueGameBuiltin);
  registerBuiltin("sum_card_values", sumCardValuesBuiltin);
  registerBuiltin("prefer_high_under", preferHighUnderBuiltin);

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
}
