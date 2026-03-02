# Card Game Engine — Copilot Instructions

A customizable card game engine driven by declarative JSON rulesets, with multi-device gameplay over local WiFi.

## Project Structure

This is a Bun monorepo with four packages:

| Package           | Purpose                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `packages/schema` | Zod validation schemas and shared types for card game rulesets                  |
| `packages/shared` | Pure TypeScript game engine — expression evaluator, interpreter, builtins, PRNG |
| `packages/host`   | Expo React Native TV app — CouchKit host + expo-file-system storage             |
| `packages/client` | Vite + React web app — phone controller UI via CouchKit client                  |

## Key Commands

```bash
bun run dev:client       # Start Vite dev server with HMR
bun run build:client     # TypeScript check + Vite production build
bun run bundle:client    # Bundle client dist into host Android assets
bun run build:android    # Bundle + Expo Android build
bun run typecheck        # Type-check shared and client packages
bun run validate         # Validate all rulesets against schema
bun run catalog          # Generate catalog.json from rulesets
```

## Testing

Tests use Vitest and live in shared, schema, and host packages:

```bash
cd packages/shared && bunx vitest run   # Engine core tests
cd packages/schema && bunx vitest run   # Schema validation tests
cd packages/host && bunx vitest run     # Host storage/importer tests
```

## Updating @couch-kit Dependencies

This project depends on @couch-kit/\* packages from npm:

- @couch-kit/core in packages/shared and packages/host and packages/client
- @couch-kit/client in packages/client
- @couch-kit/host in packages/host
- @couch-kit/cli in packages/host (dev dependency)

When updating @couch-kit packages:

1. Update versions in the relevant packages/\*/package.json files
2. Run `bun install` to update bun.lock
3. Run `bun run typecheck` to verify compatibility
4. Run `bun run build:client` to verify the client build
