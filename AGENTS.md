# AGENTS.md — Card Game Engine

## Project Overview

Bun monorepo (`bun@1.4.2`, pinned by `packageManager` in the root `package.json`) with five packages. A customizable card game engine driven by declarative JSON rulesets, with multi-device gameplay over local WiFi.

| Package | Purpose | Has Tests |
|---------|---------|-----------|
| `packages/shared` | Pure TS game engine — types, Zod schema, expression evaluator, interpreter, builtins, PRNG | Yes |
| `packages/host-core` | Framework-light host logic shared by the TV host and the browser display — catalog fetching, ruleset import, install hooks, orchestrator, built-in rulesets, theme tokens (React as a peer) | Yes |
| `packages/host` | Expo React Native TV app — CouchKit host + file storage | Yes |
| `packages/client` | Vite + React 19 web app — phone controller UI via CouchKit client | Yes |
| `packages/display` | Vite + React 19 web app — browser display that owns the game via a Cloudflare Workers relay (CouchKit display) | No |

## Build & Test Commands

```bash
# Install
bun install

# Lint + format check (Biome); `bun run format` fixes
bun run lint

# Type-check: tsc -b packages/client packages/host-core (covers shared via
# project references), then scripts/, display, and host
bun run typecheck
bun run typecheck:host     # host only, with the host's pinned TypeScript 5.9

# Build the web apps (plain `vite build`; type-checking is separate)
bun run build:client
bun run build:display

# Validate rulesets against the Zod schema
bun run validate

# Regenerate / check the editor JSON Schema derived from the Zod schema
bun run schema:generate
bun run schema:check

# Generate catalog.json from rulesets/
bun run catalog
```

### Running Tests

Tests use **Vitest** (v5). Run from each package directory:

```bash
# All tests in a package
cd packages/shared    && bunx vitest run
cd packages/host-core && bunx vitest run
cd packages/host      && bunx vitest run
cd packages/client    && bunx vitest run

# Coverage (shared and host-core report it in CI)
cd packages/shared && bunx vitest run --coverage --coverage.provider=v8

# Single test file
cd packages/shared && bunx vitest run src/engine/prng.test.ts

# Single test by name pattern
cd packages/shared && bunx vitest run -t "produces the same sequence"

# Watch mode
cd packages/shared && bunx vitest
```

### CI Pipeline (GitHub Actions)

CI (`ci.yml`) runs on every push to `main` and every PR, in parallel jobs:
1. Lint: `bunx biome ci .`
2. `bun run typecheck` + `bun run build:client` + `bun run build:display`
3. `bunx vitest run` in shared, host-core, host, client (matrix; shared and host-core with coverage)
4. `bun run validate` + `bun run schema:check` + `bun run catalog`

Shared setup (Bun from `packageManager`, install cache, frozen install) lives in the composite action `.github/actions/setup`.

`auto-release.yml` runs only after CI succeeds on `main`: it creates a **draft** release, builds the APK (`release-apk.yml`), then publishes. Android `versionCode` is `MAJOR*1000000 + MINOR*1000 + PATCH`.

## Code Style

### Formatting

Formatting and linting are enforced by [Biome](https://biomejs.dev) (`biome.json` at the root). Run `bun run lint` to check and `bun run format` to fix; CI runs the check on every PR. Use a `// biome-ignore <rule>: <reason>` comment for deliberate exceptions.


- **2-space indentation** (spaces, not tabs)
- **Double quotes** for strings
- **Semicolons** at end of statements
- **Trailing commas** in multi-line parameter lists and arrays
- **No trailing whitespace**
- Target: ES2022. The root `tsconfig.json` defaults to `module: NodeNext`, but every package overrides it with `module: ESNext` + `moduleResolution: bundler`

### Imports

- `import type { ... }` for type-only imports — separate from value imports (enforced by Biome `style/useImportType`)
- Group order: (1) type imports, (2) sibling/library value imports, (3) relative value imports
- Use explicit `.js` extensions in client package imports (ESM)
- Barrel re-exports through `index.ts` files at module boundaries

```typescript
import type { CardGameState, Player } from "../types/index";
import { parseRuleset } from "../schema/validation";
import { PhaseMachine } from "./phase-machine";
```

### TypeScript Conventions

- **`strict: true`** — no implicit any. `noUncheckedIndexedAccess` is *not* enabled (only `scripts/tsconfig.json` turns it on), so treat indexed reads (`arr[i]`, `record[key]`) as possibly `undefined` by convention and guard them
- **Branded types** for domain IDs: `PlayerId`, `GameSessionId`, `CardInstanceId`
- **Discriminated unions** on `kind` field for state variants (e.g., `GameStatus`, `EvalResult`)
- **`interface`** for object shapes with methods or extension points
- **`type`** for unions, intersections, and aliases
- **`readonly`** on all interface properties and function parameters (`readonly T[]`, `Readonly<Record<...>>`)
- **No enums** — use string literal unions or `as const` objects (enforced by Biome `style/noEnum`)
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
- Zod is only reachable through `@card-engine/shared/schema` (`parseRuleset`, `safeParseRuleset`, `loadRuleset`); the root `@card-engine/shared` entry must stay Zod-free. In the web apps and host-core, use `await import("@card-engine/shared/schema")` so the schema lands in its own async chunk
- Effect builtins record `EffectDescription` objects; the interpreter applies them (separation of intent vs. mutation)
- All randomness flows through `SeededRng` — never use `Math.random()`
- Rulesets are `.cardgame.json` files in `rulesets/`
- `packages/shared/src/schema/cardgame.v1.schema.json` is **generated** from the Zod schema in `validation.ts` by `bun run schema:generate` — never hand-edit it; CI fails on drift (`bun run schema:check`)
- The host uses `@couch-kit/*` for multi-device sync; the client uses `@couch-kit/client`

### Copilot Instructions

See `.github/copilot-instructions.md` for additional context on project structure, key commands, testing, and @couch-kit dependency management.
