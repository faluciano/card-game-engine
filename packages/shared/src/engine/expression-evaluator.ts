// ─── Expression Evaluator ──────────────────────────────────────────
// A safe, sandboxed evaluator for the ruleset's expression DSL.
// Expressions are strings like "hand_value > 21" or "card_count(hand) == 0".
// NO eval() or Function() — we parse a restricted grammar.

import type { CardGameState, Expression } from "../types/index";

// ─── AST Node Types ────────────────────────────────────────────────
// Discriminated union on `kind` field.

export interface NumberLiteral {
  readonly kind: "NumberLiteral";
  readonly value: number;
}

export interface BooleanLiteral {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
}

export interface StringLiteral {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface Identifier {
  readonly kind: "Identifier";
  readonly name: string;
}

export interface MemberAccess {
  readonly kind: "MemberAccess";
  readonly object: ASTNode;
  readonly property: string;
}

export interface FunctionCall {
  readonly kind: "FunctionCall";
  readonly callee: string;
  readonly args: readonly ASTNode[];
}

export type BinaryOperator =
  | "<"
  | ">"
  | "<="
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||"
  | "+"
  | "-"
  | "*"
  | "/";

export interface BinaryOp {
  readonly kind: "BinaryOp";
  readonly operator: BinaryOperator;
  readonly left: ASTNode;
  readonly right: ASTNode;
}

export type UnaryOperator = "!" | "-";

export interface UnaryOp {
  readonly kind: "UnaryOp";
  readonly operator: UnaryOperator;
  readonly operand: ASTNode;
}

export type ASTNode =
  | NumberLiteral
  | BooleanLiteral
  | StringLiteral
  | Identifier
  | MemberAccess
  | FunctionCall
  | BinaryOp
  | UnaryOp;

// ─── Eval Result & Context ─────────────────────────────────────────

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
  /** Named bindings injected into the evaluation scope (e.g., my_score). */
  readonly bindings?: Readonly<Record<string, EvalResult>>;
  /**
   * When scoring an NPC role, overrides `current_player` resolution
   * so `current_player.hand` maps to the NPC's zone (e.g., "dealer_hand").
   */
  readonly roleOverride?: {
    readonly roleName: string;
    readonly zoneMap: Readonly<Record<string, string>>;
  };
  /** Parameters passed from a declare action, readable via the get_param() builtin. */
  readonly actionParams?: Readonly<Record<string, string | number | boolean>>;
}

/** Error thrown when an expression is malformed or references unknown bindings. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ─── Tokens ────────────────────────────────────────────────────────

export type TokenKind =
  | "Number"
  | "Boolean"
  | "String"
  | "Identifier"
  | "Operator"
  | "LParen"
  | "RParen"
  | "Comma"
  | "Dot"
  | "EOF";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly position: number;
}

// ─── Tokenizer ─────────────────────────────────────────────────────

const OPERATOR_CHARS = new Set([
  "<",
  ">",
  "=",
  "!",
  "&",
  "|",
  "+",
  "-",
  "*",
  "/",
]);

// Two-character operators that must be matched before single-char ones
const TWO_CHAR_OPERATORS = new Set(["<=", ">=", "==", "!=", "&&", "||"]);

/**
 * Converts an expression string into an array of tokens.
 * Pure function — no side effects.
 */
export function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < expression.length) {
    const ch = expression[pos]!;

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pos++;
      continue;
    }

    // Numbers (integer or decimal)
    if (isDigit(ch)) {
      const start = pos;
      while (pos < expression.length && isDigit(expression[pos]!)) {
        pos++;
      }
      if (pos < expression.length && expression[pos] === ".") {
        pos++;
        if (pos >= expression.length || !isDigit(expression[pos]!)) {
          throw new ExpressionError(
            `Invalid number at position ${start}: trailing decimal point`
          );
        }
        while (pos < expression.length && isDigit(expression[pos]!)) {
          pos++;
        }
      }
      tokens.push({
        kind: "Number",
        value: expression.slice(start, pos),
        position: start,
      });
      continue;
    }

    // Identifiers and boolean literals
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < expression.length && isIdentContinue(expression[pos]!)) {
        pos++;
      }
      const word = expression.slice(start, pos);
      if (word === "true" || word === "false") {
        tokens.push({ kind: "Boolean", value: word, position: start });
      } else {
        tokens.push({ kind: "Identifier", value: word, position: start });
      }
      continue;
    }

    // String literals (double or single quoted)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = pos;
      pos++; // skip opening quote
      let str = "";
      while (pos < expression.length && expression[pos] !== quote) {
        if (expression[pos] === "\\") {
          pos++; // skip backslash
          if (pos >= expression.length) {
            throw new ExpressionError(
              `Unterminated string at position ${start}`
            );
          }
          const escaped = expression[pos]!;
          switch (escaped) {
            case "n":
              str += "\n";
              break;
            case "t":
              str += "\t";
              break;
            case "\\":
              str += "\\";
              break;
            case '"':
              str += '"';
              break;
            case "'":
              str += "'";
              break;
            default:
              str += escaped;
          }
        } else {
          str += expression[pos];
        }
        pos++;
      }
      if (pos >= expression.length) {
        throw new ExpressionError(`Unterminated string at position ${start}`);
      }
      pos++; // skip closing quote
      tokens.push({ kind: "String", value: str, position: start });
      continue;
    }

    // Operators (two-char first, then single-char)
    if (OPERATOR_CHARS.has(ch)) {
      const start = pos;
      if (pos + 1 < expression.length) {
        const twoChar = expression.slice(pos, pos + 2);
        if (TWO_CHAR_OPERATORS.has(twoChar)) {
          tokens.push({ kind: "Operator", value: twoChar, position: start });
          pos += 2;
          continue;
        }
      }
      // Single-char operators (but reject lone `=`, `&`, `|`)
      if (ch === "=" || ch === "&" || ch === "|") {
        throw new ExpressionError(
          `Unexpected character '${ch}' at position ${pos}. Did you mean '${ch}${ch}'?`
        );
      }
      tokens.push({ kind: "Operator", value: ch, position: start });
      pos++;
      continue;
    }

    // Punctuation
    if (ch === "(") {
      tokens.push({ kind: "LParen", value: "(", position: pos });
      pos++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "RParen", value: ")", position: pos });
      pos++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "Comma", value: ",", position: pos });
      pos++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ kind: "Dot", value: ".", position: pos });
      pos++;
      continue;
    }

    throw new ExpressionError(
      `Unexpected character '${ch}' at position ${pos}`
    );
  }

  tokens.push({ kind: "EOF", value: "", position: pos });
  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

// ─── Parser ────────────────────────────────────────────────────────
// Recursive descent parser. Operator precedence (low → high):
//   ||  →  &&  →  ==, !=  →  <, >, <=, >=  →  +, -  →  *, /  →  unary !, -  →  call, member

const MAX_AST_NODES = 1000;

/**
 * Parses a token stream into an AST.
 * Pure function — no side effects.
 *
 * @throws {ExpressionError} on syntax errors or if the AST exceeds 1000 nodes.
 */
export function parse(tokens: readonly Token[]): ASTNode {
  let pos = 0;
  let nodeCount = 0;

  function countNode(): void {
    nodeCount++;
    if (nodeCount > MAX_AST_NODES) {
      throw new ExpressionError(
        `Expression too complex: AST exceeds ${MAX_AST_NODES} nodes`
      );
    }
  }

  function current(): Token {
    return tokens[pos] ?? { kind: "EOF", value: "", position: -1 };
  }

  function advance(): Token {
    const tok = current();
    pos++;
    return tok;
  }

  function expect(kind: TokenKind, value?: string): Token {
    const tok = current();
    if (tok.kind !== kind || (value !== undefined && tok.value !== value)) {
      throw new ExpressionError(
        `Expected ${value ? `'${value}'` : kind} at position ${tok.position}, got '${tok.value}'`
      );
    }
    return advance();
  }

  // ── Precedence levels ──

  function parseExpression(): ASTNode {
    return parseOr();
  }

  function parseOr(): ASTNode {
    let left = parseAnd();
    while (current().kind === "Operator" && current().value === "||") {
      const op = advance().value as BinaryOperator;
      const right = parseAnd();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseAnd(): ASTNode {
    let left = parseEquality();
    while (current().kind === "Operator" && current().value === "&&") {
      const op = advance().value as BinaryOperator;
      const right = parseEquality();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseEquality(): ASTNode {
    let left = parseComparison();
    while (
      current().kind === "Operator" &&
      (current().value === "==" || current().value === "!=")
    ) {
      const op = advance().value as BinaryOperator;
      const right = parseComparison();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseComparison(): ASTNode {
    let left = parseAdditive();
    while (
      current().kind === "Operator" &&
      (current().value === "<" ||
        current().value === ">" ||
        current().value === "<=" ||
        current().value === ">=")
    ) {
      const op = advance().value as BinaryOperator;
      const right = parseAdditive();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseAdditive(): ASTNode {
    let left = parseMultiplicative();
    while (
      current().kind === "Operator" &&
      (current().value === "+" || current().value === "-")
    ) {
      const op = advance().value as BinaryOperator;
      const right = parseMultiplicative();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseMultiplicative(): ASTNode {
    let left = parseUnary();
    while (
      current().kind === "Operator" &&
      (current().value === "*" || current().value === "/")
    ) {
      const op = advance().value as BinaryOperator;
      const right = parseUnary();
      countNode();
      left = { kind: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  function parseUnary(): ASTNode {
    if (current().kind === "Operator" && current().value === "!") {
      advance();
      const operand = parseUnary();
      countNode();
      return { kind: "UnaryOp", operator: "!", operand };
    }
    if (current().kind === "Operator" && current().value === "-") {
      advance();
      const operand = parseUnary();
      countNode();
      return { kind: "UnaryOp", operator: "-", operand };
    }
    return parseCallOrMember();
  }

  function parseCallOrMember(): ASTNode {
    let node = parsePrimary();

    while (true) {
      // Member access: node.property
      if (current().kind === "Dot") {
        advance();
        const propTok = expect("Identifier");
        countNode();
        node = {
          kind: "MemberAccess",
          object: node,
          property: propTok.value,
        };
        continue;
      }
      break;
    }

    return node;
  }

  function parsePrimary(): ASTNode {
    const tok = current();

    // Number literal
    if (tok.kind === "Number") {
      advance();
      countNode();
      return { kind: "NumberLiteral", value: Number(tok.value) };
    }

    // Boolean literal
    if (tok.kind === "Boolean") {
      advance();
      countNode();
      return { kind: "BooleanLiteral", value: tok.value === "true" };
    }

    // String literal
    if (tok.kind === "String") {
      advance();
      countNode();
      return { kind: "StringLiteral", value: tok.value };
    }

    // Identifier — might be followed by `(` for function call, or `.` for member
    if (tok.kind === "Identifier") {
      advance();

      // Function call: identifier immediately followed by `(`
      if (current().kind === "LParen") {
        advance(); // consume `(`
        const args: ASTNode[] = [];

        if (current().kind !== "RParen") {
          args.push(parseExpression());
          while (current().kind === "Comma") {
            advance(); // consume `,`
            args.push(parseExpression());
          }
        }

        expect("RParen");
        countNode();
        return { kind: "FunctionCall", callee: tok.value, args };
      }

      // Plain identifier (may be followed by `.` for member access, handled in parseCallOrMember)
      countNode();
      return { kind: "Identifier", name: tok.value };
    }

    // Parenthesized expression
    if (tok.kind === "LParen") {
      advance();
      const inner = parseExpression();
      expect("RParen");
      return inner;
    }

    throw new ExpressionError(
      `Unexpected token '${tok.value}' at position ${tok.position}`
    );
  }

  const ast = parseExpression();

  // Ensure we consumed all tokens
  if (current().kind !== "EOF") {
    const tok = current();
    throw new ExpressionError(
      `Unexpected token '${tok.value}' at position ${tok.position} (expected end of expression)`
    );
  }

  return ast;
}

// ─── Function Registry ─────────────────────────────────────────────

/**
 * A builtin function callable from expressions.
 * Receives evaluated argument values and the eval context.
 * Returns an EvalResult, or void for side-effecting functions.
 */
export type BuiltinFunction = (
  args: readonly EvalResult[],
  context: EvalContext
) => EvalResult | void;

/** Registry of builtin functions available to the expression evaluator. */
const functionRegistry = new Map<string, BuiltinFunction>();

/**
 * Registers a builtin function that expressions can call.
 * Overwrites any existing function with the same name.
 */
export function registerBuiltin(name: string, fn: BuiltinFunction): void {
  functionRegistry.set(name, fn);
}

/**
 * Removes a builtin function from the registry.
 * Returns true if the function existed, false otherwise.
 */
export function unregisterBuiltin(name: string): boolean {
  return functionRegistry.delete(name);
}

/**
 * Returns a snapshot of all registered builtin function names.
 * Useful for diagnostics and testing.
 */
export function getRegisteredBuiltins(): readonly string[] {
  return Array.from(functionRegistry.keys());
}

/**
 * Clears all registered builtins.
 * Intended for testing — not for production use.
 */
export function clearBuiltins(): void {
  functionRegistry.clear();
}

// ─── Evaluator ─────────────────────────────────────────────────────

const MAX_EVAL_DEPTH = 64;

/**
 * Resolves a binding name against the evaluation context.
 * Looks up in:
 *   1. Explicit game state properties (zones, scores, special names)
 *   2. State-level bindings
 *
 * Returns undefined if the binding is not found.
 */
function resolveBinding(
  name: string,
  context: EvalContext
): EvalResult | Record<string, unknown> | undefined {
  const { state } = context;

  // Special identifiers that map to game state
  switch (name) {
    case "current_player": {
      // NPC role override — build a synthetic player-like object
      if (context.roleOverride) {
        const { roleName, zoneMap } = context.roleOverride;
        const playerObj: Record<string, unknown> = {
          role: roleName,
        };
        for (const [baseKey, zoneName] of Object.entries(zoneMap)) {
          playerObj[baseKey] = zoneName;
        }
        return playerObj as Record<string, unknown>;
      }

      // Human player — existing logic below
      const idx = context.playerIndex ?? state.currentPlayerIndex;
      const playerObj: Record<string, unknown> = {
        index: idx,
        player: state.players[idx],
        name: state.players[idx]?.name,
        role: state.players[idx]?.role,
      };
      // Add per-player zone shortcuts: for zones named "{base}:{playerIdx}",
      // make `current_player.{base}` resolve to the zone name string.
      for (const zoneName of Object.keys(state.zones)) {
        const colonIdx = zoneName.indexOf(":");
        if (colonIdx !== -1) {
          const base = zoneName.substring(0, colonIdx);
          const zoneIdx = zoneName.substring(colonIdx + 1);
          if (zoneIdx === String(idx)) {
            playerObj[base] = zoneName;
          }
        }
      }
      return playerObj as Record<string, unknown>;
    }
    case "current_player_index":
      return {
        kind: "number",
        value: context.playerIndex ?? state.currentPlayerIndex,
      };
    case "turn_number":
      return { kind: "number", value: state.turnNumber };
    case "player_count":
      return { kind: "number", value: state.players.length };
  }

  // Explicit bindings (e.g., my_score injected by determine_winners)
  if (context.bindings && name in context.bindings) {
    return context.bindings[name]!;
  }

  // Zone lookup — zones are referenced by name directly.
  // Returns the zone name as a string so builtins can look it up via resolveZoneName.
  if (name in state.zones) {
    return { kind: "string", value: name };
  }

  // Per-player zone template lookup — e.g., "hand" matches "hand:0", "hand:1", etc.
  // Returns the base name as a string for effect builtins (deal, draw) to expand.
  const isPerPlayerTemplate = Object.keys(state.zones).some(
    (zoneName) => zoneName.startsWith(`${name}:`)
  );
  if (isPerPlayerTemplate) {
    return { kind: "string", value: name };
  }

  // Score lookup
  if (name in state.scores) {
    return { kind: "number", value: state.scores[name]! };
  }

  // Variable lookup
  if (state.variables && name in state.variables) {
    return { kind: "number", value: state.variables[name]! };
  }

  return undefined;
}

/**
 * Resolves a member access on a resolved object.
 */
function resolveMember(
  obj: unknown,
  property: string,
): unknown {
  if (obj === null || obj === undefined) {
    throw new ExpressionError(
      `Cannot access property '${property}' of ${String(obj)}`
    );
  }
  if (typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    if (property in record) {
      return record[property];
    }
    throw new ExpressionError(
      `Property '${property}' not found on object`
    );
  }
  throw new ExpressionError(
    `Cannot access property '${property}' of ${typeof obj}`
  );
}

/**
 * Converts a raw resolved value to an EvalResult.
 * Opaque objects (zones, players) are not directly representable as EvalResult —
 * they must be consumed by function calls.
 */
function toEvalResult(value: unknown, description: string): EvalResult {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as EvalResult).kind === "boolean"
  ) {
    return value as EvalResult;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as EvalResult).kind === "number"
  ) {
    return value as EvalResult;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as EvalResult).kind === "string"
  ) {
    return value as EvalResult;
  }
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }
  if (typeof value === "number") {
    return { kind: "number", value };
  }
  if (typeof value === "string") {
    return { kind: "string", value };
  }

  throw new ExpressionError(
    `Cannot convert ${description} to an expression result`
  );
}

/**
 * Evaluates an AST node against a context.
 * Depth-guarded to prevent stack overflow.
 */
function evaluateNode(
  node: ASTNode,
  context: EvalContext,
  depth: number
): EvalResult {
  if (depth > MAX_EVAL_DEPTH) {
    throw new ExpressionError(
      `Maximum evaluation depth (${MAX_EVAL_DEPTH}) exceeded`
    );
  }

  switch (node.kind) {
    case "NumberLiteral":
      return { kind: "number", value: node.value };

    case "BooleanLiteral":
      return { kind: "boolean", value: node.value };

    case "StringLiteral":
      return { kind: "string", value: node.value };

    case "Identifier":
      return evaluateIdentifier(node, context);

    case "MemberAccess":
      return evaluateMemberAccess(node, context, depth);

    case "FunctionCall":
      return evaluateFunctionCall(node, context, depth);

    case "BinaryOp":
      return evaluateBinaryOp(node, context, depth);

    case "UnaryOp":
      return evaluateUnaryOp(node, context, depth);
  }
}

function evaluateIdentifier(node: Identifier, context: EvalContext): EvalResult {
  const resolved = resolveBinding(node.name, context);
  if (resolved === undefined) {
    // Fall back to calling a registered zero-arg builtin function.
    // This enables bare identifiers like `all_players_done` (without parentheses)
    // to resolve as implicit function calls in transition conditions.
    const fn = functionRegistry.get(node.name);
    if (fn) {
      const result = fn([], context);
      if (result !== undefined && result !== null) {
        return result;
      }
    }
    throw new ExpressionError(`Unknown identifier: '${node.name}'`);
  }
  return toEvalResult(resolved, `identifier '${node.name}'`);
}

/**
 * Evaluates a member access chain, resolving the raw object path.
 */
function evaluateRawValue(
  node: ASTNode,
  context: EvalContext,
  depth: number
): unknown {
  if (depth > MAX_EVAL_DEPTH) {
    throw new ExpressionError(
      `Maximum evaluation depth (${MAX_EVAL_DEPTH}) exceeded`
    );
  }

  switch (node.kind) {
    case "Identifier": {
      const resolved = resolveBinding(node.name, context);
      if (resolved === undefined) {
        throw new ExpressionError(`Unknown identifier: '${node.name}'`);
      }
      return resolved;
    }
    case "MemberAccess": {
      const obj = evaluateRawValue(node.object, context, depth + 1);
      return resolveMember(obj, node.property);
    }
    default:
      // For other node types, evaluate normally and return the result
      return evaluateNode(node, context, depth);
  }
}

function evaluateMemberAccess(
  node: MemberAccess,
  context: EvalContext,
  depth: number
): EvalResult {
  const raw = evaluateRawValue(node, context, depth + 1);
  return toEvalResult(raw, `member access .${node.property}`);
}

/** Maximum iterations for while() special form to prevent infinite loops. */
const MAX_WHILE_ITERATIONS = 100;

function evaluateFunctionCall(
  node: FunctionCall,
  context: EvalContext,
  depth: number
): EvalResult {
  // ── Special form: while(condition, body) ──
  // Must be handled before regular lookup because arguments need lazy evaluation.
  // The condition and body AST nodes are re-evaluated each iteration.
  if (node.callee === "while") {
    if (node.args.length !== 2) {
      throw new ExpressionError(
        "while() requires exactly 2 arguments: condition, body"
      );
    }
    let iterations = 0;
    while (true) {
      if (iterations >= MAX_WHILE_ITERATIONS) {
        throw new ExpressionError(
          `while() exceeded maximum iterations (${MAX_WHILE_ITERATIONS})`
        );
      }
      const condResult = evaluateNode(node.args[0]!, context, depth + 1);
      if (condResult.kind !== "boolean") {
        throw new ExpressionError(
          `while() condition must be boolean, got ${condResult.kind}`
        );
      }
      if (!condResult.value) break;
      evaluateNode(node.args[1]!, context, depth + 1);
      iterations++;

      // Flush accumulated effects into state so the next condition
      // re-evaluation sees updated zones (e.g., draw() adding cards).
      // Duck-typed to avoid circular imports with builtins.ts.
      const mctx = context as Record<string, unknown>;
      if (
        typeof mctx.applyEffectsToState === "function" &&
        Array.isArray(mctx.effects) &&
        (mctx.effects as unknown[]).length > 0
      ) {
        const applyFn = mctx.applyEffectsToState as (
          state: CardGameState,
          effects: unknown[]
        ) => CardGameState;
        const newState = applyFn(
          context.state,
          [...(mctx.effects as unknown[])]
        );
        (context as { state: CardGameState }).state = newState;
        (mctx.effects as unknown[]).length = 0;
      }
    }
    return { kind: "boolean", value: true };
  }

  // ── Special form: if(condition, then_expr[, else_expr]) ──
  // Must be handled before regular lookup because arguments need lazy evaluation.
  // Only the chosen branch is evaluated, not both.
  if (node.callee === "if") {
    if (node.args.length < 2 || node.args.length > 3) {
      throw new ExpressionError(
        "if() requires 2-3 arguments: condition, then_expr[, else_expr]"
      );
    }
    const condResult = evaluateNode(node.args[0]!, context, depth + 1);
    if (condResult.kind !== "boolean") {
      throw new ExpressionError(
        `if() condition must be boolean, got ${condResult.kind}`
      );
    }
    if (condResult.value) {
      return evaluateNode(node.args[1]!, context, depth + 1);
    }
    if (node.args.length === 3) {
      return evaluateNode(node.args[2]!, context, depth + 1);
    }
    return { kind: "boolean", value: true };
  }

  const fn = functionRegistry.get(node.callee);
  if (!fn) {
    throw new ExpressionError(`Unknown function: '${node.callee}'`);
  }

  const evaluatedArgs = node.args.map((arg) =>
    evaluateNode(arg, context, depth + 1)
  );

  const result = fn(evaluatedArgs, context);

  // Side-effecting functions may return void — treat as boolean true (success)
  if (result === undefined || result === null) {
    return { kind: "boolean", value: true };
  }

  return result;
}

function evaluateBinaryOp(
  node: BinaryOp,
  context: EvalContext,
  depth: number
): EvalResult {
  // Short-circuit evaluation for logical operators
  if (node.operator === "&&") {
    const left = evaluateNode(node.left, context, depth + 1);
    if (left.kind !== "boolean") {
      throw new ExpressionError(
        `Left operand of '&&' must be boolean, got ${left.kind}`
      );
    }
    if (!left.value) return { kind: "boolean", value: false };
    const right = evaluateNode(node.right, context, depth + 1);
    if (right.kind !== "boolean") {
      throw new ExpressionError(
        `Right operand of '&&' must be boolean, got ${right.kind}`
      );
    }
    return { kind: "boolean", value: right.value };
  }

  if (node.operator === "||") {
    const left = evaluateNode(node.left, context, depth + 1);
    if (left.kind !== "boolean") {
      throw new ExpressionError(
        `Left operand of '||' must be boolean, got ${left.kind}`
      );
    }
    if (left.value) return { kind: "boolean", value: true };
    const right = evaluateNode(node.right, context, depth + 1);
    if (right.kind !== "boolean") {
      throw new ExpressionError(
        `Right operand of '||' must be boolean, got ${right.kind}`
      );
    }
    return { kind: "boolean", value: right.value };
  }

  const left = evaluateNode(node.left, context, depth + 1);
  const right = evaluateNode(node.right, context, depth + 1);

  switch (node.operator) {
    case "==":
      return { kind: "boolean", value: left.value === right.value };
    case "!=":
      return { kind: "boolean", value: left.value !== right.value };

    case "<":
    case ">":
    case "<=":
    case ">=":
      return evaluateComparison(node.operator, left, right);

    case "+":
    case "-":
    case "*":
    case "/":
      return evaluateArithmetic(node.operator, left, right);
  }
}

function evaluateComparison(
  op: "<" | ">" | "<=" | ">=",
  left: EvalResult,
  right: EvalResult
): EvalResult {
  if (left.kind !== "number" || right.kind !== "number") {
    throw new ExpressionError(
      `Comparison '${op}' requires numeric operands, got ${left.kind} and ${right.kind}`
    );
  }
  switch (op) {
    case "<":
      return { kind: "boolean", value: left.value < right.value };
    case ">":
      return { kind: "boolean", value: left.value > right.value };
    case "<=":
      return { kind: "boolean", value: left.value <= right.value };
    case ">=":
      return { kind: "boolean", value: left.value >= right.value };
  }
}

function evaluateArithmetic(
  op: "+" | "-" | "*" | "/",
  left: EvalResult,
  right: EvalResult
): EvalResult {
  if (left.kind !== "number" || right.kind !== "number") {
    throw new ExpressionError(
      `Arithmetic '${op}' requires numeric operands, got ${left.kind} and ${right.kind}`
    );
  }
  if (op === "/" && right.value === 0) {
    throw new ExpressionError("Division by zero");
  }
  switch (op) {
    case "+":
      return { kind: "number", value: left.value + right.value };
    case "-":
      return { kind: "number", value: left.value - right.value };
    case "*":
      return { kind: "number", value: left.value * right.value };
    case "/":
      return { kind: "number", value: left.value / right.value };
  }
}

function evaluateUnaryOp(
  node: UnaryOp,
  context: EvalContext,
  depth: number
): EvalResult {
  const operand = evaluateNode(node.operand, context, depth + 1);

  switch (node.operator) {
    case "!":
      if (operand.kind !== "boolean") {
        throw new ExpressionError(
          `Unary '!' requires boolean operand, got ${operand.kind}`
        );
      }
      return { kind: "boolean", value: !operand.value };

    case "-":
      if (operand.kind !== "number") {
        throw new ExpressionError(
          `Unary '-' requires numeric operand, got ${operand.kind}`
        );
      }
      return { kind: "number", value: -operand.value };
  }
}

// ─── Public API ────────────────────────────────────────────────────

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

  const tokens = tokenize(expression);
  const ast = parse(tokens);
  return evaluateNode(ast, context, 0);
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
