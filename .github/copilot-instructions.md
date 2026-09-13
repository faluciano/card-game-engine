# Card Game Engine — Copilot Instructions

A customizable card game engine driven by declarative JSON rulesets, with multi-device gameplay over local WiFi.

## Project Structure

This is a Bun monorepo with five packages:

| Package           | Purpose                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `packages/shared` | Pure TypeScript game engine — types, Zod schema, expression evaluator, interpreter, builtins, PRNG |
| `packages/host-core` | Framework-light host logic shared by the TV host and the browser display — catalog fetching, ruleset import, install hooks, orchestrator, built-in rulesets, theme tokens (React as a peer) |
| `packages/host`   | Expo React Native TV app — CouchKit host + expo-file-system storage             |
| `packages/client` | Vite + React web app — phone controller UI via CouchKit client                  |
| `packages/display` | Vite + React web app — browser display that owns the game via a Cloudflare Workers relay |

## Key Commands

```bash
bun run dev:client       # Start Vite dev server with HMR
bun run build:client     # TypeScript check + Vite production build
bun run bundle:client    # Bundle client dist into host Android assets
bun run build:android    # Bundle + Expo Android build
bun run typecheck        # tsc -b packages/client packages/host-core (shared via references), then display and host
bun run typecheck:host   # Type-check the host package only
bun run dev:display      # Start the browser display dev server
bun run build:display    # Build the browser display
bun run lint             # Biome lint + format check
bun run validate         # Validate all rulesets against schema
bun run catalog          # Generate catalog.json from rulesets
```

## Testing

Tests use Vitest and live in shared and host packages:

```bash
cd packages/shared && bunx vitest run   # Engine core + schema validation tests
cd packages/host-core && bunx vitest run # Catalog, URL import, install-hook tests
cd packages/host && bunx vitest run     # Host storage/file-import tests
```

## Updating @couch-kit Dependencies

This project depends on @couch-kit/\* packages from npm:

- @couch-kit/core in packages/shared, packages/host, and packages/display
- @couch-kit/client in packages/client
- @couch-kit/display in packages/display
- @couch-kit/host in packages/host
- @couch-kit/cli in packages/host (dev dependency)

When updating @couch-kit packages:

1. Update versions in the relevant packages/\*/package.json files
2. Run `bun install` to update bun.lock
3. Run `bun run typecheck` to verify compatibility
4. Run `bun run build:client` to verify the client build
