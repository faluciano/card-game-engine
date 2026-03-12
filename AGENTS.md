# AGENTS.md — Card Game Engine

## Project Overview

Bun monorepo (`bun@1.2.19`) with four packages. A customizable card game engine driven by declarative JSON rulesets, with multi-device gameplay over local WiFi.

| Package | Purpose | Has Tests |
|---------|---------|-----------|
| `packages/schema` | Zod validation schemas and shared TypeScript types | Yes |
| `packages/shared` | Pure TS game engine — expression evaluator, interpreter, builtins, PRNG | Yes |
| `packages/host` | Expo React Native TV app — CouchKit host + file storage | Yes |
| `packages/client` | Vite + React 18 web app — phone controller UI via CouchKit client | No |

## Build & Test Commands

```bash
# Install
bun install

# Type-check (shared + client)
bun run typecheck

# Build client
bun run build:client

# Validate rulesets against schema
bun run validate

# Generate catalog.json from rulesets/
bun run catalog
```

### Running Tests

Tests use **Vitest** (v3.2). Run from each package directory:

```bash
# All tests in a package
cd packages/shared && bunx vitest run
cd packages/schema && bunx vitest run
cd packages/host   && bunx vitest run

# Single test file
cd packages/shared && bunx vitest run src/engine/prng.test.ts

# Single test by name pattern
cd packages/shared && bunx vitest run -t "produces the same sequence"

# Watch mode
cd packages/shared && bunx vitest
```

### CI Pipeline (GitHub Actions)

CI runs on every push to `main` and every PR:
1. `bun run typecheck` + `bun run build:client`
2. `bunx vitest run` in shared, schema, host (parallel matrix)
3. `bun run validate` (ruleset validation)

## Code Style

### Formatting

- **2-space indentation** (spaces, not tabs)
- **Double quotes** for strings
- **Semicolons** at end of statements
- **Trailing commas** in multi-line parameter lists and arrays
- **No trailing whitespace**
- Target: ES2022, module: NodeNext

### Imports

- `import type { ... }` for type-only imports — separate from value imports
- Group order: (1) type imports, (2) sibling/library value imports, (3) relative value imports
- Use explicit `.js` extensions in client package imports (ESM)
- Barrel re-exports through `index.ts` files at module boundaries

```typescript
import type { CardGameState, Player } from "../types/index";
import { parseRuleset } from "../schema/validation";
import { PhaseMachine } from "./phase-machine";
```

### TypeScript Conventions

- **`strict: true`** — no implicit any, no unchecked index access
- **Branded types** for domain IDs: `PlayerId`, `GameSessionId`, `CardInstanceId`
- **Discriminated unions** on `kind` field for state variants (e.g., `GameStatus`, `EvalResult`)
- **`interface`** for object shapes with methods or extension points
- **`type`** for unions, intersections, and aliases
- **`readonly`** on all interface properties and function parameters (`readonly T[]`, `Readonly<Record<...>>`)
- **No enums** — use string literal unions or `as const` objects
- **Non-null assertion (`!`)** only after bounds-checked array access (e.g., `array[i]!` after confirming `i < array.length`)

### Naming Conventions

| Category | Convention | Examples |
|----------|-----------|----------|
| Files | `kebab-case.ts` | `expression-evaluator.ts`, `phase-machine.ts` |
| Test files | `*.test.ts` colocated with source | `prng.test.ts`, `builtins.test.ts` |
| Types/Interfaces | `PascalCase` | `CardGameState`, `PhaseDefinition`, `EvalResult` |
| Functions | `camelCase`, verb-first | `createReducer`, `evaluateCondition`, `computeHandValue` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_ACTION_LOG_SIZE`, `EVAL_TRUE` |
| Boolean vars | Question-phrased | `isHuman`, `faceUp`, `connected` |
| Builtin names | `snake_case` (DSL convention) | `hand_value`, `card_count`, `all_players_done` |

### Section Headers

Files use ASCII box-drawing comment headers to delimit major sections:

```typescript
// ─── Section Name ──────────────────────────────────────────────────
```

### Error Handling — The 5 Laws

1. **Early Exit / Guard Clauses** — Check failure first, return/throw early, keep happy path flat
2. **Parse, Don't Validate** — Zod schema is the parse boundary; after `parseRuleset()` succeeds, trust the types
3. **Atomic Predictability** — Engine is a pure reducer `(state, action) => state`. Never mutate input. Deterministic via seeded PRNG
4. **Fail Fast, Fail Loud** — Descriptive errors with context. No silent fallbacks. `ExpressionError` includes expression text
5. **Intentional Naming** — Types describe what they *are*; functions describe what they *do*

Custom error classes extend `Error` with a `name` property:

```typescript
export class RulesetParseError extends Error {
  constructor(message: string, public readonly issues: readonly string[]) {
    super(message);
    this.name = "RulesetParseError";
  }
}
```

### Functions & Components

- **Arrow functions** (`const fn: Type = (args) => { ... }`) for builtin function values and callbacks
- **`function` declarations** for exported/named functions and React components
- React components return `React.JSX.Element` explicitly
- React component props use `interface` with `readonly` properties

### Testing Style

- Use `describe` / `it` / `expect` from Vitest
- Nested `describe` blocks for logical grouping (e.g., per-method)
- Test names read as plain English: `"produces the same sequence for the same seed"`
- ASCII box-drawing headers for test sections matching source style
- Test edge cases: empty arrays, boundary values, wrong argument counts, error messages

### Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`

### Architecture Rules

- `packages/shared` has **zero framework dependencies** — pure TypeScript only
- Effect builtins record `EffectDescription` objects; the interpreter applies them (separation of intent vs. mutation)
- All randomness flows through `SeededRng` — never use `Math.random()`
- Rulesets are `.cardgame.json` files in `rulesets/`
- The host uses `@couch-kit/*` for multi-device sync; the client uses `@couch-kit/client`

### Copilot Instructions

See `.github/copilot-instructions.md` for additional context on project structure, key commands, testing, and @couch-kit dependency management.
