import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tokenize,
  parse,
  evaluateExpression,
  evaluateCondition,
  ExpressionError,
  registerBuiltin,
  clearBuiltins,
  type EvalContext,
  type EvalResult,
  type ASTNode,
  type Token,
} from "./expression-evaluator.js";
import type {
  CardGameState,
  GameSessionId,
  PlayerId,
} from "../types/index.js";

// ─── Test Helpers ──────────────────────────────────────────────────

function makeSessionId(id: string): GameSessionId {
  return id as GameSessionId;
}

function makePlayerId(id: string): PlayerId {
  return id as PlayerId;
}

function createMockState(overrides?: Partial<CardGameState>): CardGameState {
  return {
    sessionId: makeSessionId("test-session"),
    ruleset: {
      meta: {
        name: "Test Game",
        slug: "test-game",
        version: "1.0.0",
        author: "test",
        players: { min: 1, max: 6 },
      },
      deck: { preset: "standard_52", copies: 1, cardValues: {} },
      zones: [],
      roles: [],
      phases: [],
      scoring: {
        method: "none",
        winCondition: "true",
        bustCondition: "false",
      },
      visibility: [],
      ui: { layout: "semicircle", tableColor: "felt_green" },
    } as CardGameState["ruleset"],
    status: { kind: "in_progress", startedAt: 0 },
    players: [
      { id: makePlayerId("p1"), name: "Alice", role: "player", connected: true },
      { id: makePlayerId("p2"), name: "Bob", role: "player", connected: true },
    ],
    zones: {
      hand: {
        definition: { name: "hand", visibility: { kind: "owner_only" }, owners: ["player"] },
        cards: [],
      },
      dealer_hand: {
        definition: { name: "dealer_hand", visibility: { kind: "partial", rule: "first_card_only" }, owners: ["dealer"] },
        cards: [],
      },
      draw_pile: {
        definition: { name: "draw_pile", visibility: { kind: "hidden" }, owners: [] },
        cards: [],
      },
    },
    currentPhase: "player_turns",
    currentPlayerIndex: 0,
    turnNumber: 1,
    scores: {},
    actionLog: [],
    version: 1,
    ...overrides,
  } as CardGameState;
}

function makeContext(overrides?: Partial<CardGameState>): EvalContext {
  return { state: createMockState(overrides) };
}

/** Extracts just `kind` and `value` from each token (drops position for brevity). */
function tokenKinds(tokens: readonly Token[]): Array<{ kind: string; value: string }> {
  return tokens.map(({ kind, value }) => ({ kind, value }));
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("expression-evaluator", () => {
  beforeEach(() => {
    clearBuiltins();
  });

  afterEach(() => {
    clearBuiltins();
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Tokenizer ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("tokenize", () => {
    describe("numbers", () => {
      it("tokenizes an integer", () => {
        const tokens = tokenize("42");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Number", value: "42" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes a decimal number", () => {
        const tokens = tokenize("3.14");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Number", value: "3.14" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes zero", () => {
        const tokens = tokenize("0");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Number", value: "0" },
          { kind: "EOF", value: "" },
        ]);
      });
    });

    describe("booleans", () => {
      it("tokenizes true", () => {
        const tokens = tokenize("true");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Boolean", value: "true" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes false", () => {
        const tokens = tokenize("false");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Boolean", value: "false" },
          { kind: "EOF", value: "" },
        ]);
      });
    });

    describe("identifiers", () => {
      it("tokenizes snake_case identifiers", () => {
        const tokens = tokenize("hand_value");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "hand_value" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes identifiers with underscores and letters", () => {
        const tokens = tokenize("current_player");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "current_player" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes identifiers containing digits", () => {
        const tokens = tokenize("all_players_done");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "all_players_done" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes identifiers starting with underscore", () => {
        const tokens = tokenize("_private");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "_private" },
          { kind: "EOF", value: "" },
        ]);
      });
    });

    describe("strings", () => {
      it("tokenizes double-quoted strings", () => {
        const tokens = tokenize('"hello"');
        expect(tokenKinds(tokens)).toEqual([
          { kind: "String", value: "hello" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes single-quoted strings", () => {
        const tokens = tokenize("'world'");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "String", value: "world" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("handles escape sequences in strings", () => {
        const tokens = tokenize('"line1\\nline2"');
        expect(tokens[0]!.value).toBe("line1\nline2");
      });

      it("handles escaped backslash", () => {
        const tokens = tokenize('"back\\\\slash"');
        expect(tokens[0]!.value).toBe("back\\slash");
      });

      it("handles escaped quotes inside strings", () => {
        const tokens = tokenize('"say \\"hi\\""');
        expect(tokens[0]!.value).toBe('say "hi"');
      });

      it("handles tab escape", () => {
        const tokens = tokenize('"col1\\tcol2"');
        expect(tokens[0]!.value).toBe("col1\tcol2");
      });
    });

    describe("operators", () => {
      it.each([
        ["<", "Operator", "<"],
        [">", "Operator", ">"],
        ["<=", "Operator", "<="],
        [">=", "Operator", ">="],
        ["==", "Operator", "=="],
        ["!=", "Operator", "!="],
        ["&&", "Operator", "&&"],
        ["||", "Operator", "||"],
        ["+", "Operator", "+"],
        ["-", "Operator", "-"],
        ["*", "Operator", "*"],
        ["/", "Operator", "/"],
        ["!", "Operator", "!"],
      ] as const)("tokenizes %s", (input, expectedKind, expectedValue) => {
        const tokens = tokenize(input);
        expect(tokens[0]).toMatchObject({ kind: expectedKind, value: expectedValue });
      });
    });

    describe("punctuation", () => {
      it.each([
        ["(", "LParen", "("],
        [")", "RParen", ")"],
        [",", "Comma", ","],
        [".", "Dot", "."],
      ] as const)("tokenizes %s", (input, expectedKind, expectedValue) => {
        const tokens = tokenize(input);
        expect(tokens[0]).toMatchObject({ kind: expectedKind, value: expectedValue });
      });
    });

    describe("combined expressions", () => {
      it("tokenizes a complex expression", () => {
        const tokens = tokenize("hand_value(dealer_hand) >= 17");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "hand_value" },
          { kind: "LParen", value: "(" },
          { kind: "Identifier", value: "dealer_hand" },
          { kind: "RParen", value: ")" },
          { kind: "Operator", value: ">=" },
          { kind: "Number", value: "17" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes arithmetic with multiple operators", () => {
        const tokens = tokenize("1 + 2 * 3");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Number", value: "1" },
          { kind: "Operator", value: "+" },
          { kind: "Number", value: "2" },
          { kind: "Operator", value: "*" },
          { kind: "Number", value: "3" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("tokenizes logical expression", () => {
        const tokens = tokenize("a && b || c");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "a" },
          { kind: "Operator", value: "&&" },
          { kind: "Identifier", value: "b" },
          { kind: "Operator", value: "||" },
          { kind: "Identifier", value: "c" },
          { kind: "EOF", value: "" },
        ]);
      });

      it("records correct positions for each token", () => {
        const tokens = tokenize("x + y");
        expect(tokens[0]!.position).toBe(0); // x
        expect(tokens[1]!.position).toBe(2); // +
        expect(tokens[2]!.position).toBe(4); // y
      });

      it("skips whitespace (spaces, tabs, newlines)", () => {
        const tokens = tokenize("  a  \t\n  +  b  ");
        expect(tokenKinds(tokens)).toEqual([
          { kind: "Identifier", value: "a" },
          { kind: "Operator", value: "+" },
          { kind: "Identifier", value: "b" },
          { kind: "EOF", value: "" },
        ]);
      });
    });

    describe("error cases", () => {
      it("throws on lone = (suggests ==)", () => {
        expect(() => tokenize("x = 5")).toThrow(ExpressionError);
        expect(() => tokenize("x = 5")).toThrow("Did you mean '=='");
      });

      it("throws on lone & (suggests &&)", () => {
        expect(() => tokenize("a & b")).toThrow(ExpressionError);
        expect(() => tokenize("a & b")).toThrow("Did you mean '&&'");
      });

      it("throws on lone | (suggests ||)", () => {
        expect(() => tokenize("a | b")).toThrow(ExpressionError);
        expect(() => tokenize("a | b")).toThrow("Did you mean '||'");
      });

      it("throws on unterminated double-quoted string", () => {
        expect(() => tokenize('"unterminated')).toThrow(ExpressionError);
        expect(() => tokenize('"unterminated')).toThrow("Unterminated string");
      });

      it("throws on unterminated single-quoted string", () => {
        expect(() => tokenize("'unterminated")).toThrow(ExpressionError);
        expect(() => tokenize("'unterminated")).toThrow("Unterminated string");
      });

      it("throws on trailing decimal point", () => {
        expect(() => tokenize("42.")).toThrow(ExpressionError);
        expect(() => tokenize("42.")).toThrow("trailing decimal point");
      });

      it("throws on unexpected character", () => {
        expect(() => tokenize("x @ y")).toThrow(ExpressionError);
        expect(() => tokenize("x @ y")).toThrow("Unexpected character");
      });

      it("throws on unterminated escape at end of string", () => {
        expect(() => tokenize('"trailing\\')).toThrow(ExpressionError);
        expect(() => tokenize('"trailing\\')).toThrow("Unterminated string");
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Parser ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("parse", () => {
    /** Helper: tokenize + parse in one step. */
    function parseExpr(expr: string): ASTNode {
      return parse(tokenize(expr));
    }

    describe("literals", () => {
      it("parses an integer literal", () => {
        expect(parseExpr("42")).toEqual({ kind: "NumberLiteral", value: 42 });
      });

      it("parses a decimal literal", () => {
        expect(parseExpr("3.14")).toEqual({ kind: "NumberLiteral", value: 3.14 });
      });

      it("parses zero", () => {
        expect(parseExpr("0")).toEqual({ kind: "NumberLiteral", value: 0 });
      });

      it("parses true", () => {
        expect(parseExpr("true")).toEqual({ kind: "BooleanLiteral", value: true });
      });

      it("parses false", () => {
        expect(parseExpr("false")).toEqual({ kind: "BooleanLiteral", value: false });
      });

      it("parses a string literal", () => {
        expect(parseExpr('"hello"')).toEqual({ kind: "StringLiteral", value: "hello" });
      });

      it("parses an identifier", () => {
        expect(parseExpr("x")).toEqual({ kind: "Identifier", name: "x" });
      });
    });

    describe("operator precedence", () => {
      it("multiplication binds tighter than addition: 1 + 2 * 3 → 1 + (2 * 3)", () => {
        const ast = parseExpr("1 + 2 * 3");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: "+",
          left: { kind: "NumberLiteral", value: 1 },
          right: {
            kind: "BinaryOp",
            operator: "*",
            left: { kind: "NumberLiteral", value: 2 },
            right: { kind: "NumberLiteral", value: 3 },
          },
        });
      });

      it("subtraction is left-associative: 5 - 3 - 1 → (5 - 3) - 1", () => {
        const ast = parseExpr("5 - 3 - 1");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: "-",
          left: {
            kind: "BinaryOp",
            operator: "-",
            left: { kind: "NumberLiteral", value: 5 },
            right: { kind: "NumberLiteral", value: 3 },
          },
          right: { kind: "NumberLiteral", value: 1 },
        });
      });

      it("comparison binds tighter than logical: a && b > c → a && (b > c)", () => {
        const ast = parseExpr("a && b > 5");
        // && is lower precedence than >, so it should be:
        // BinaryOp(&&, Identifier(a), BinaryOp(>, Identifier(b), NumberLiteral(5)))
        expect(ast.kind).toBe("BinaryOp");
        expect((ast as any).operator).toBe("&&");
        expect((ast as any).right.kind).toBe("BinaryOp");
        expect((ast as any).right.operator).toBe(">");
      });

      it("|| binds looser than &&: a && b || c → (a && b) || c", () => {
        const ast = parseExpr("a && b || c");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: "||",
          left: {
            kind: "BinaryOp",
            operator: "&&",
            left: { kind: "Identifier", name: "a" },
            right: { kind: "Identifier", name: "b" },
          },
          right: { kind: "Identifier", name: "c" },
        });
      });

      it("equality binds tighter than &&: a == 1 && b != 2 → (a == 1) && (b != 2)", () => {
        const ast = parseExpr("a == 1 && b != 2");
        expect(ast.kind).toBe("BinaryOp");
        expect((ast as any).operator).toBe("&&");
        expect((ast as any).left.operator).toBe("==");
        expect((ast as any).right.operator).toBe("!=");
      });

      it("comparison binds tighter than equality: x < 5 == true → (x < 5) == true", () => {
        const ast = parseExpr("x < 5 == true");
        expect(ast.kind).toBe("BinaryOp");
        expect((ast as any).operator).toBe("==");
        expect((ast as any).left.operator).toBe("<");
      });
    });

    describe("comparison operators", () => {
      it("parses x > 5 as BinaryOp with >", () => {
        const ast = parseExpr("x > 5");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: ">",
          left: { kind: "Identifier", name: "x" },
          right: { kind: "NumberLiteral", value: 5 },
        });
      });

      it("parses x >= 5", () => {
        const ast = parseExpr("x >= 5");
        expect(ast).toMatchObject({ kind: "BinaryOp", operator: ">=" });
      });

      it("parses x < 5", () => {
        const ast = parseExpr("x < 5");
        expect(ast).toMatchObject({ kind: "BinaryOp", operator: "<" });
      });

      it("parses x <= 5", () => {
        const ast = parseExpr("x <= 5");
        expect(ast).toMatchObject({ kind: "BinaryOp", operator: "<=" });
      });
    });

    describe("function calls", () => {
      it("parses a no-arg function call", () => {
        const ast = parseExpr("noop()");
        expect(ast).toEqual({
          kind: "FunctionCall",
          callee: "noop",
          args: [],
        });
      });

      it("parses a single-arg function call", () => {
        const ast = parseExpr("hand_value(x)");
        expect(ast).toEqual({
          kind: "FunctionCall",
          callee: "hand_value",
          args: [{ kind: "Identifier", name: "x" }],
        });
      });

      it("parses a multi-arg function call", () => {
        const ast = parseExpr("deal(a, b, 2)");
        expect(ast).toEqual({
          kind: "FunctionCall",
          callee: "deal",
          args: [
            { kind: "Identifier", name: "a" },
            { kind: "Identifier", name: "b" },
            { kind: "NumberLiteral", value: 2 },
          ],
        });
      });

      it("parses nested function call arguments", () => {
        const ast = parseExpr("outer(inner(x))");
        expect(ast).toEqual({
          kind: "FunctionCall",
          callee: "outer",
          args: [
            {
              kind: "FunctionCall",
              callee: "inner",
              args: [{ kind: "Identifier", name: "x" }],
            },
          ],
        });
      });
    });

    describe("member access", () => {
      it("parses simple member access", () => {
        const ast = parseExpr("current_player.hand");
        expect(ast).toEqual({
          kind: "MemberAccess",
          object: { kind: "Identifier", name: "current_player" },
          property: "hand",
        });
      });

      it("parses chained member access", () => {
        const ast = parseExpr("a.b.c");
        expect(ast).toEqual({
          kind: "MemberAccess",
          object: {
            kind: "MemberAccess",
            object: { kind: "Identifier", name: "a" },
            property: "b",
          },
          property: "c",
        });
      });
    });

    describe("nested expressions", () => {
      it("parses function call on member access result", () => {
        const ast = parseExpr("hand_value(current_player.hand) < 21");
        expect(ast.kind).toBe("BinaryOp");
        expect((ast as any).operator).toBe("<");
        expect((ast as any).left.kind).toBe("FunctionCall");
        expect((ast as any).left.callee).toBe("hand_value");
        expect((ast as any).left.args[0].kind).toBe("MemberAccess");
      });
    });

    describe("parenthesized expressions", () => {
      it("overrides default precedence: (a + b) * c", () => {
        const ast = parseExpr("(a + b) * c");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: "*",
          left: {
            kind: "BinaryOp",
            operator: "+",
            left: { kind: "Identifier", name: "a" },
            right: { kind: "Identifier", name: "b" },
          },
          right: { kind: "Identifier", name: "c" },
        });
      });

      it("nested parentheses", () => {
        const ast = parseExpr("((1 + 2))");
        expect(ast).toEqual({
          kind: "BinaryOp",
          operator: "+",
          left: { kind: "NumberLiteral", value: 1 },
          right: { kind: "NumberLiteral", value: 2 },
        });
      });
    });

    describe("unary operators", () => {
      it("parses logical NOT", () => {
        const ast = parseExpr("!done");
        expect(ast).toEqual({
          kind: "UnaryOp",
          operator: "!",
          operand: { kind: "Identifier", name: "done" },
        });
      });

      it("parses unary negation", () => {
        const ast = parseExpr("-5");
        expect(ast).toEqual({
          kind: "UnaryOp",
          operator: "-",
          operand: { kind: "NumberLiteral", value: 5 },
        });
      });

      it("parses double negation", () => {
        const ast = parseExpr("!!true");
        expect(ast).toEqual({
          kind: "UnaryOp",
          operator: "!",
          operand: {
            kind: "UnaryOp",
            operator: "!",
            operand: { kind: "BooleanLiteral", value: true },
          },
        });
      });

      it("unary has higher precedence than binary: -a + b → (-a) + b", () => {
        const ast = parseExpr("-a + b");
        expect(ast.kind).toBe("BinaryOp");
        expect((ast as any).operator).toBe("+");
        expect((ast as any).left.kind).toBe("UnaryOp");
        expect((ast as any).left.operator).toBe("-");
      });
    });

    describe("error cases", () => {
      it("throws on unclosed parenthesis", () => {
        expect(() => parseExpr("(a + b")).toThrow(ExpressionError);
      });

      it("throws on unexpected token at start", () => {
        expect(() => parseExpr(")")).toThrow(ExpressionError);
      });

      it("throws on trailing tokens after complete expression", () => {
        expect(() => parseExpr("1 2")).toThrow(ExpressionError);
        expect(() => parseExpr("1 2")).toThrow("expected end of expression");
      });

      it("throws on unclosed function call", () => {
        expect(() => parseExpr("foo(a, b")).toThrow(ExpressionError);
      });

      it("throws when AST exceeds maximum node count", () => {
        // Generate a massive expression to exceed 1000 nodes
        // Each "a + " adds 2 nodes (identifier + binary op), so ~500+ terms
        const bigExpr = Array.from({ length: 600 }, () => "a").join(" + ");
        expect(() => parseExpr(bigExpr)).toThrow(ExpressionError);
        expect(() => parseExpr(bigExpr)).toThrow("AST exceeds");
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Evaluator ────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("evaluateExpression", () => {
    describe("arithmetic", () => {
      it("evaluates addition: 2 + 3 → 5", () => {
        const result = evaluateExpression("2 + 3", makeContext());
        expect(result).toEqual({ kind: "number", value: 5 });
      });

      it("evaluates subtraction: 10 - 4 → 6", () => {
        const result = evaluateExpression("10 - 4", makeContext());
        expect(result).toEqual({ kind: "number", value: 6 });
      });

      it("evaluates multiplication: 3 * 7 → 21", () => {
        const result = evaluateExpression("3 * 7", makeContext());
        expect(result).toEqual({ kind: "number", value: 21 });
      });

      it("evaluates division: 10 / 2 → 5", () => {
        const result = evaluateExpression("10 / 2", makeContext());
        expect(result).toEqual({ kind: "number", value: 5 });
      });

      it("evaluates decimal division: 7 / 2 → 3.5", () => {
        const result = evaluateExpression("7 / 2", makeContext());
        expect(result).toEqual({ kind: "number", value: 3.5 });
      });

      it("respects operator precedence: 2 + 3 * 4 → 14", () => {
        const result = evaluateExpression("2 + 3 * 4", makeContext());
        expect(result).toEqual({ kind: "number", value: 14 });
      });

      it("respects parentheses: (2 + 3) * 4 → 20", () => {
        const result = evaluateExpression("(2 + 3) * 4", makeContext());
        expect(result).toEqual({ kind: "number", value: 20 });
      });

      it("throws on division by zero", () => {
        expect(() => evaluateExpression("10 / 0", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("10 / 0", makeContext())).toThrow("Division by zero");
      });

      it("throws when arithmetic applied to non-numeric operands", () => {
        expect(() => evaluateExpression("true + 1", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("true + 1", makeContext())).toThrow("requires numeric operands");
      });
    });

    describe("comparison", () => {
      it("evaluates 5 > 3 → true", () => {
        const result = evaluateExpression("5 > 3", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates 3 > 5 → false", () => {
        const result = evaluateExpression("3 > 5", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates 2 >= 2 → true", () => {
        const result = evaluateExpression("2 >= 2", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates 1 >= 2 → false", () => {
        const result = evaluateExpression("1 >= 2", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates 3 < 5 → true", () => {
        const result = evaluateExpression("3 < 5", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates 5 <= 5 → true", () => {
        const result = evaluateExpression("5 <= 5", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("throws when comparison applied to non-numeric operands", () => {
        expect(() => evaluateExpression("true > 1", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("true > 1", makeContext())).toThrow("requires numeric operands");
      });
    });

    describe("equality", () => {
      it("evaluates 5 == 5 → true", () => {
        const result = evaluateExpression("5 == 5", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates 5 == 6 → false", () => {
        const result = evaluateExpression("5 == 6", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates 5 != 6 → true", () => {
        const result = evaluateExpression("5 != 6", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates true == true → true", () => {
        const result = evaluateExpression("true == true", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates true == false → false", () => {
        const result = evaluateExpression("true == false", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates string equality", () => {
        const result = evaluateExpression('"abc" == "abc"', makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates string inequality", () => {
        const result = evaluateExpression('"abc" != "def"', makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });
    });

    describe("logical operators", () => {
      it("evaluates true && true → true", () => {
        const result = evaluateExpression("true && true", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates true && false → false", () => {
        const result = evaluateExpression("true && false", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates false && true → false", () => {
        const result = evaluateExpression("false && true", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates true || false → true", () => {
        const result = evaluateExpression("true || false", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates false || false → false", () => {
        const result = evaluateExpression("false || false", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("throws when left operand of && is not boolean", () => {
        expect(() => evaluateExpression("1 && true", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("1 && true", makeContext())).toThrow("must be boolean");
      });

      it("throws when right operand of || is not boolean", () => {
        expect(() => evaluateExpression("false || 1", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("false || 1", makeContext())).toThrow("must be boolean");
      });
    });

    describe("short-circuit evaluation", () => {
      it("false && error_func() does NOT evaluate the right side", () => {
        let called = false;
        registerBuiltin("error_func", () => {
          called = true;
          throw new Error("should not be called");
        });
        const result = evaluateExpression("false && error_func()", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
        expect(called).toBe(false);
      });

      it("true || error_func() does NOT evaluate the right side", () => {
        let called = false;
        registerBuiltin("error_func", () => {
          called = true;
          throw new Error("should not be called");
        });
        const result = evaluateExpression("true || error_func()", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
        expect(called).toBe(false);
      });

      it("true && expr evaluates the right side", () => {
        let called = false;
        registerBuiltin("track", () => {
          called = true;
          return { kind: "boolean", value: true };
        });
        evaluateExpression("true && track()", makeContext());
        expect(called).toBe(true);
      });

      it("false || expr evaluates the right side", () => {
        let called = false;
        registerBuiltin("track", () => {
          called = true;
          return { kind: "boolean", value: false };
        });
        evaluateExpression("false || track()", makeContext());
        expect(called).toBe(true);
      });
    });

    describe("identifier resolution", () => {
      it("resolves turn_number from state", () => {
        const result = evaluateExpression("turn_number", makeContext({ turnNumber: 7 }));
        expect(result).toEqual({ kind: "number", value: 7 });
      });

      it("resolves player_count from state", () => {
        const result = evaluateExpression("player_count", makeContext());
        expect(result).toEqual({ kind: "number", value: 2 });
      });

      it("resolves current_player_index from state", () => {
        const result = evaluateExpression("current_player_index", makeContext({ currentPlayerIndex: 1 }));
        expect(result).toEqual({ kind: "number", value: 1 });
      });

      it("resolves score identifiers", () => {
        const result = evaluateExpression("team_score", makeContext({ scores: { team_score: 42 } }));
        expect(result).toEqual({ kind: "number", value: 42 });
      });

      it("throws on unknown identifier", () => {
        expect(() => evaluateExpression("nonexistent_var", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("nonexistent_var", makeContext())).toThrow("Unknown identifier");
      });
    });

    describe("unary operators", () => {
      it("evaluates !true → false", () => {
        const result = evaluateExpression("!true", makeContext());
        expect(result).toEqual({ kind: "boolean", value: false });
      });

      it("evaluates !false → true", () => {
        const result = evaluateExpression("!false", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
      });

      it("evaluates -5 → -5", () => {
        const result = evaluateExpression("-5", makeContext());
        expect(result).toEqual({ kind: "number", value: -5 });
      });

      it("evaluates --5 → 5 (double negation)", () => {
        const result = evaluateExpression("--5", makeContext());
        expect(result).toEqual({ kind: "number", value: 5 });
      });

      it("throws when ! applied to non-boolean", () => {
        expect(() => evaluateExpression("!5", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("!5", makeContext())).toThrow("requires boolean operand");
      });

      it("throws when - applied to non-number", () => {
        expect(() => evaluateExpression("-true", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("-true", makeContext())).toThrow("requires numeric operand");
      });
    });

    describe("string literals", () => {
      it("evaluates a string literal", () => {
        const result = evaluateExpression('"hello"', makeContext());
        expect(result).toEqual({ kind: "string", value: "hello" });
      });
    });

    describe("custom builtins", () => {
      it("registers and calls a custom builtin", () => {
        registerBuiltin("double", (args) => {
          const arg = args[0]!;
          if (arg.kind !== "number") throw new ExpressionError("expected number");
          return { kind: "number", value: arg.value * 2 };
        });
        const result = evaluateExpression("double(21)", makeContext());
        expect(result).toEqual({ kind: "number", value: 42 });
      });

      it("passes context to the builtin", () => {
        registerBuiltin("get_turn", (_args, ctx) => {
          return { kind: "number", value: ctx.state.turnNumber };
        });
        const result = evaluateExpression("get_turn()", makeContext({ turnNumber: 5 }));
        expect(result).toEqual({ kind: "number", value: 5 });
      });

      it("side-effecting function returning void is treated as true", () => {
        let sideEffect = 0;
        registerBuiltin("increment", () => {
          sideEffect++;
          // returns void
        });
        const result = evaluateExpression("increment()", makeContext());
        expect(result).toEqual({ kind: "boolean", value: true });
        expect(sideEffect).toBe(1);
      });

      it("throws on unknown function", () => {
        expect(() => evaluateExpression("unknown_func()", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("unknown_func()", makeContext())).toThrow("Unknown function");
      });
    });

    describe("error handling", () => {
      it("throws on empty expression", () => {
        expect(() => evaluateExpression("", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("", makeContext())).toThrow("Empty expression");
      });

      it("throws on whitespace-only expression", () => {
        expect(() => evaluateExpression("   ", makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression("   ", makeContext())).toThrow("Empty expression");
      });

      it("ExpressionError has the correct name property", () => {
        try {
          evaluateExpression("", makeContext());
        } catch (e) {
          expect(e).toBeInstanceOf(ExpressionError);
          expect((e as ExpressionError).name).toBe("ExpressionError");
        }
      });
    });

    describe("depth guard", () => {
      it("throws on deeply nested expression exceeding max depth", () => {
        // Build a deeply nested expression: (((((...(1)...)))))
        // The evaluator has MAX_EVAL_DEPTH = 64
        // Each level of nesting in binary ops increases depth.
        // Use a chain of additions which are left-associative but parsed as a deep tree.
        // Actually, left-associative parsing creates a left-leaning tree, not deep.
        // To trigger depth, we need right-recursion via unary or parenthesized nesting.
        // Build: -(-(-(-(-(1))))) ... 70+ levels
        const expr = "-".repeat(70) + "5";
        expect(() => evaluateExpression(expr, makeContext())).toThrow(ExpressionError);
        expect(() => evaluateExpression(expr, makeContext())).toThrow("Maximum evaluation depth");
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── evaluateCondition ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("evaluateCondition", () => {
    it("returns true for a true boolean expression", () => {
      expect(evaluateCondition("5 > 3", makeContext())).toBe(true);
    });

    it("returns false for a false boolean expression", () => {
      expect(evaluateCondition("5 < 3", makeContext())).toBe(false);
    });

    it("throws on non-boolean expression result", () => {
      expect(() => evaluateCondition("2 + 3", makeContext())).toThrow(ExpressionError);
      expect(() => evaluateCondition("2 + 3", makeContext())).toThrow("Expected boolean expression");
    });

    it("throws on string expression result", () => {
      expect(() => evaluateCondition('"hello"', makeContext())).toThrow(ExpressionError);
      expect(() => evaluateCondition('"hello"', makeContext())).toThrow("Expected boolean expression");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── while special form ───────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("while special form", () => {
    it("executes 0 times when condition is immediately false", () => {
      let callCount = 0;
      registerBuiltin("noop", () => {
        callCount++;
      });
      const result = evaluateExpression("while(false, noop())", makeContext());
      expect(result).toEqual({ kind: "boolean", value: true });
      expect(callCount).toBe(0);
    });

    it("executes body the correct number of times using a counter builtin", () => {
      // We simulate a counter by using a builtin that tracks calls
      // and a condition builtin that returns false after N calls
      let counter = 0;
      const maxIterations = 5;

      registerBuiltin("check_counter", () => {
        return { kind: "boolean", value: counter < maxIterations };
      });
      registerBuiltin("increment_counter", () => {
        counter++;
      });

      const result = evaluateExpression(
        "while(check_counter(), increment_counter())",
        makeContext()
      );
      expect(result).toEqual({ kind: "boolean", value: true });
      expect(counter).toBe(maxIterations);
    });

    it("throws when exceeding max iterations", () => {
      registerBuiltin("noop", () => {});
      expect(() =>
        evaluateExpression("while(true, noop())", makeContext())
      ).toThrow(ExpressionError);
      expect(() =>
        evaluateExpression("while(true, noop())", makeContext())
      ).toThrow("exceeded maximum iterations");
    });

    it("throws on wrong number of arguments", () => {
      expect(() => evaluateExpression("while(true)", makeContext())).toThrow(
        "requires exactly 2 arguments"
      );
      registerBuiltin("noop", () => {});
      expect(() => evaluateExpression("while(true, noop(), noop())", makeContext())).toThrow(
        "requires exactly 2 arguments"
      );
    });

    it("throws on non-boolean condition", () => {
      registerBuiltin("noop", () => {});
      registerBuiltin("get_num", () => ({ kind: "number" as const, value: 1 }));
      expect(() =>
        evaluateExpression("while(get_num(), noop())", makeContext())
      ).toThrow("condition must be boolean");
    });
  });
});
