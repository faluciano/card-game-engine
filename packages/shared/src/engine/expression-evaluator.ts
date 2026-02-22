// ─── Expression Evaluator ──────────────────────────────────────────
// A safe, sandboxed evaluator for the ruleset's expression DSL.
// Expressions are strings like "hand_value > 21" or "card_count(hand) == 0".
// NO eval() or Function() — we parse a restricted grammar.

import type { CardGameState, Expression } from "../types/index.js";

/**
 * The result of evaluating an expression.
 * Discriminated to distinguish booleans from numeric results.
 */
export type EvalResult =
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string };

/**
 * Context provided to expression evaluation.
 * Contains bindings the expression can reference.
 */
export interface EvalContext {
  readonly state: CardGameState;
  readonly playerIndex?: number;
}

/**
 * Evaluates a DSL expression against the current game context.
 * Uses a restricted grammar — no arbitrary code execution.
 *
 * @throws {ExpressionError} if the expression is syntactically invalid.
 */
export function evaluateExpression(
  expression: Expression,
  context: EvalContext
): EvalResult {
  if (!expression || expression.trim().length === 0) {
    throw new ExpressionError("Empty expression");
  }

  // TODO: Tokenize expression string
  // TODO: Parse into AST (restricted: comparisons, arithmetic, function calls)
  // TODO: Evaluate AST against context bindings
  // TODO: Return typed result
  throw new Error("Not implemented: evaluateExpression");
}

/**
 * Evaluates an expression and coerces the result to a boolean.
 * Convenience wrapper for transition conditions.
 */
export function evaluateCondition(
  expression: Expression,
  context: EvalContext
): boolean {
  const result = evaluateExpression(expression, context);
  if (result.kind !== "boolean") {
    throw new ExpressionError(
      `Expected boolean expression, got ${result.kind}: "${expression}"`
    );
  }
  return result.value;
}

/** Error thrown when an expression is malformed or references unknown bindings. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}
