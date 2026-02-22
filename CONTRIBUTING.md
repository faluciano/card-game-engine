# Contributing to card-game-engine

Thank you for your interest in contributing. This document covers the conventions, architecture, and workflows you need to get productive quickly.

## Table of Contents

- [Getting Started](#getting-started)
- [Code Style — The 5 Laws of Elegant Defense](#code-style--the-5-laws-of-elegant-defense)
- [Project Architecture](#project-architecture)
- [Testing Requirements](#testing-requirements)
- [Making Changes](#making-changes)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Getting Started

```bash
git clone <repo-url>
cd card-game-engine
bun install
```

Run the engine test suite to verify everything works:

```bash
cd packages/shared && bunx vitest run
```

This is a monorepo with three packages:

| Package | Purpose |
|---------|---------|
| `packages/shared` | Pure TypeScript game engine. Zero framework dependencies. All game logic lives here. |
| `packages/host` | Expo React Native TV app. Wires the engine to CouchKit and persists state in SQLite. |
| `packages/client` | Vite + React web app. Thin UI shell that renders `PlayerView` and sends actions. |

Example rulesets live in `rulesets/` as `.cardgame.json` files.

## Code Style -- The 5 Laws of Elegant Defense

This project follows five specific coding principles. All contributions must adhere to them.

### Law 1: Early Exit / Guard Clauses

Check failure conditions first. Return or throw early. Keep the happy path at the lowest indentation level. No deeply nested if/else chains.

```typescript
// Good — guard clause, then happy path
function getZone(state: CardGameState, name: string): ZoneState {
  const zone = state.zones[name];
  if (!zone) {
    throw new ExpressionError(`Unknown zone: '${name}'`);
  }
  return zone;
}

// Bad — unnecessary nesting
function getZone(state: CardGameState, name: string): ZoneState {
  const zone = state.zones[name];
  if (zone) {
    return zone;
  } else {
    throw new ExpressionError(`Unknown zone: '${name}'`);
  }
}
```

### Law 2: Parse, Don't Validate

Make illegal states unrepresentable through the type system.

**Branded types** prevent mixing up raw strings:

```typescript
export type PlayerId = string & { readonly __brand: unique symbol };
export type GameSessionId = string & { readonly __brand: unique symbol };
export type CardInstanceId = string & { readonly __brand: unique symbol };
```

**Discriminated unions** make each variant carry exactly the data it needs:

```typescript
export type GameStatus =
  | { readonly kind: "waiting_for_players" }
  | { readonly kind: "in_progress"; readonly startedAt: number }
  | { readonly kind: "paused"; readonly pausedAt: number }
  | { readonly kind: "finished"; readonly finishedAt: number; readonly winnerId: PlayerId | null };
```

**Validate at the boundary, then trust the types internally.** The Zod schema in `schema/validation.ts` is the parse boundary. After `parseRuleset()` succeeds, the rest of the engine works with trusted types -- no re-validation.

### Law 3: Atomic Predictability / Pure Functions

The game engine is a pure reducer: `(state, action) => state`.

- Never mutate input state. Always return new objects.
- Deterministic: same seed + same actions = same outcome (seeded PRNG).
- Side effects are recorded as `EffectDescription` objects, then applied separately by the interpreter.

```typescript
// Effect builtins record intent, not mutation
function pushEffect(context: EvalContext, effect: EffectDescription): void {
  const mctx = context as MutableEvalContext;
  if (!mctx.effects || !Array.isArray(mctx.effects)) {
    throw new ExpressionError(
      `Effect builtin '${effect.kind}' requires a MutableEvalContext with an effects array`
    );
  }
  mctx.effects.push(effect);
}
```

### Law 4: Fail Fast, Fail Loud

- Invalid actions throw immediately with descriptive errors.
- Expression evaluation errors include the expression text and context.
- No silent fallbacks that mask bugs.
- `RulesetParseError` includes all Zod issues so the caller sees every problem at once.

```typescript
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
```

### Law 5: Intentional Naming

| Category | Convention | Examples |
|----------|-----------|----------|
| Types | Describe what they **are**, not what they contain | `PlayerView`, not `FilteredState` |
| Functions | Describe what they **do** | `createPlayerView`, `evaluateTransitions`, `computeHandValue` |
| Booleans | Phrased as questions | `isHuman`, `faceUp`, `connected` |
| Abbreviations | Only well-known ones | `id`, `PRNG`, `FSM`, `AST` |

## Project Architecture

```
card-game-engine/
  packages/
    shared/         Pure TS engine, zero framework deps
      src/
        types/        Branded types, discriminated unions, state interfaces
        schema/       Zod validation — the parse boundary
        deck/         Deck presets and card instantiation
        engine/       Reducer, interpreter, expression evaluator, builtins, PRNG
    host/           Expo React Native TV app (CouchKit + SQLite)
    client/         Vite + React web app (renders PlayerView, sends actions)
  rulesets/         Example .cardgame.json files
```

Data flows in one direction: a `.cardgame.json` ruleset is parsed at the boundary, producing a trusted `CardGameRuleset`. The interpreter creates initial state and a reducer. The host app drives the reducer with actions; the client app renders a filtered `PlayerView`.

## Testing Requirements

All engine logic must have tests. The test suite currently has 419 tests across 8 files.

**Run tests:**

```bash
cd packages/shared && bunx vitest run
```

**Watch mode:**

```bash
cd packages/shared && bunx vitest
```

**What to test when adding new builtins:**

- Correct return value for valid inputs
- Error on wrong argument count
- Integration with the interpreter (end-to-end through expression evaluation)

**What to test when adding new expression features:**

- Parsing (the expression is parsed correctly)
- Evaluation (produces the right result)
- Edge cases (empty inputs, boundary values)
- Error messages (descriptive, includes the expression text)

## Making Changes

### Adding a new builtin function

1. Add the function in `builtins.ts` inside `registerAllBuiltins()`.
2. **Query builtins** are pure functions: read from `context.state`, return an `EvalResult`. Do not push effects.
3. **Effect builtins** push an `EffectDescription` to `context.effects` and return `true`.
4. If it is an effect builtin, add the corresponding effect handler in `interpreter.ts`.
5. Add tests in `builtins.test.ts`.
6. Document the function in the builtin catalog in `packages/shared/README.md`.

### Adding a new deck preset

1. Add the factory function in `deck/presets.ts`:

    ```typescript
    export function myCustomDeck(): readonly CardTemplate[] {
      const cards: CardTemplate[] = [];
      // ... build cards ...
      return cards;
    }
    ```

2. Add the preset name to the `DeckPreset` type in `types/ruleset.ts`:

    ```typescript
    export type DeckPreset = "standard_52" | "standard_54" | "uno_108" | "my_custom";
    ```

3. Add the case to `getPresetDeck()` in `deck/presets.ts`:

    ```typescript
    case "my_custom":
      return myCustomDeck();
    ```

4. Add the new preset string to the Zod schema in `schema/validation.ts`.

### Writing a new ruleset

1. Create `rulesets/your-game.cardgame.json`.
2. Follow the format described in `docs/ruleset-authoring.md`.
3. Validate the ruleset programmatically with `parseRuleset()` or `safeParseRuleset()`.
4. Write an integration test similar to the ones in `integration.test.ts` that runs a full game sequence.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add DISCARD effect builtin for discarding cards
fix: handle dual-value cards correctly in hand value computation
test: cover edge cases for expression evaluator ternary operator
docs: document new deck preset in builtin catalog
refactor: extract zone lookup into shared helper
chore: update bun lockfile
```

Keep messages concise. Focus on **why** the change was made, not a line-by-line description of what changed.

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes, following the 5 Laws and testing requirements above.
3. Ensure all tests pass:

    ```bash
    cd packages/shared && bunx vitest run
    ```

4. Ensure types check:

    ```bash
    bun run typecheck
    ```

5. One feature per PR. If your change touches multiple concerns, split it into separate pull requests.
6. Provide a clear description of what the PR does and why. Link to any relevant issues.
