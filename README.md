# Card Game Engine

A customizable card game engine driven by declarative JSON rulesets, with multi-device gameplay over local WiFi.

Card Game Engine lets you define the rules of any card game — blackjack, poker, UNO, and more — in a `.cardgame.json` file. The engine loads the ruleset at runtime, manages game state through a phase-based finite state machine, and enforces all rules without a single line of game-specific code. An Android TV acts as the shared display and game host, while players connect their phones as controllers by scanning a QR code.

## Architecture

```
   +------------------+        CouchKit (WiFi)        +------------------+
   |   Android TV     | <---------------------------> |   Phone (1..n)   |
   |   (Host)         |                               |   (Client)       |
   |                  |   game state, player views     |                  |
   |  Expo + RN-tvOS  | ----------------------------> |  Vite + React    |
   |  expo-file-system |                               |                  |
   |                  |   player actions               |                  |
   |  Game Engine     | <---------------------------- |  Controller UI   |
   +------------------+                               +------------------+
          |
          v
   .cardgame.json ruleset
```

The TV runs the authoritative game engine: it loads the ruleset, advances the FSM, evaluates expressions, and filters state per player. Phones receive only their own view of the game and send actions back to the host. All networking is handled by [CouchKit](https://github.com/faluciano/react-native-couch-kit) over local WiFi with no internet required.

## Features

- **Declarative JSON rulesets** — define game logic without writing code
- **Safe expression language** — conditions and effects use a constrained (non-Turing-complete) evaluator with `if()` conditional branching and `while()` loops
- **26 query builtins + 15 effect builtins** — covering common card game mechanics (draw, discard, shuffle, score, card matching, pattern matching, turn order, etc.)
- **Phase-based FSM** — supports automatic, player_action, and simultaneous phase types
- **Turn order mechanics** — clockwise/counterclockwise direction, reverse, skip, and set-next-player effects
- **Seeded PRNG** — mulberry32 enables deterministic replay from an action log
- **Hidden information** — per-player state filtering via `createPlayerView`
- **Zod schema validation** — rulesets are validated against a strict schema at load time
- **3 deck presets + custom decks** — `standard52`, `standard54`, `uno108`, plus fully custom card lists

## Project Structure

```
card-game-engine/
├── packages/
│   ├── shared/        @card-engine/shared   — game engine core (types, expression
│   │                                          evaluator, interpreter, PRNG)
│   ├── schema/        @card-engine/schema   — JSON Schema, Zod validation, types
│   │                                          (card, ruleset, state)
│   ├── host/          @card-engine/host     — Android TV app (Expo + CouchKit host
│   │                                          + expo-file-system storage)
│   └── client/        @card-engine/client   — phone controller (Vite + React +
│                                              CouchKit client)
├── rulesets/          .cardgame.json rule files
├── package.json       Bun monorepo root (workspaces)
└── tsconfig.json      composite TS project references
```

| Package | Runtime | Key Dependencies |
|---------|---------|------------------|
| `schema` | Pure TypeScript | Zod |
| `shared` | Pure TypeScript, zero framework deps | @card-engine/schema, Zod |
| `host` | Expo + React Native | CouchKit host, expo-file-system |
| `client` | Vite + React 18 | CouchKit client |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.2.19
- Android TV device or emulator (for running the host)
- Modern browser (for client development)

### Install

```sh
git clone https://github.com/faluciano/card-game-engine.git
cd card-game-engine
bun install
```

### Development

Start the client dev server (hot-reloading web app):

```sh
bun run dev:client
```

### Testing

Tests live in the shared, schema, and host packages and use Vitest:

```sh
cd packages/shared
bunx vitest run
```

913 tests across the shared (804), schema (15), and host (94) packages cover the engine core (expression evaluator, builtins, interpreter, PRNG, schema validation, player views, game phases, integration scenarios), schema meta fields, and the host package (storage, importers). The client package is verified via `tsc` type-checking and Vite production build.

### Build and Deploy

Build the client, bundle it for CouchKit, and run on Android TV:

```sh
bun run build:android
```

This is a shorthand that bundles the client assets and launches the Expo Android build. You can also run the steps individually:

```sh
bun run build:client       # TypeScript check + Vite production build
bun run bundle:client      # Bundle client dist into the host's Android assets
```

Type-check the shared and client packages:

```sh
bun run typecheck
```

### Scripts

| Command | Description |
|---------|-------------|
| `bun run dev:client` | Start the client Vite dev server with HMR |
| `bun run build:client` | TypeScript check + Vite production build |
| `bun run bundle:client` | Bundle client dist into host's Android assets |
| `bun run build:android` | Bundle client + Expo Android build |
| `bun run typecheck` | Type-check shared and client packages |
| `bun run validate` | Validate all rulesets against the JSON Schema |
| `bun run catalog` | Generate `catalog.json` from all rulesets' metadata |

## Rulesets

A `.cardgame.json` file declaratively defines everything the engine needs to run a card game: metadata, deck composition, zones, roles, phases (FSM), scoring, visibility rules, and UI hints.

The [`rulesets/`](rulesets/) directory contains example rulesets:

- **`blackjack.cardgame.json`** — the reference implementation demonstrating dealer AI, hand value scoring, and partial visibility
- **`war.cardgame.json`** — a simple rank-comparison game showcasing automatic phases and multi-round play
- **`crazy-eights.cardgame.json`** — a matching game demonstrating `if()` conditional branching, card matching builtins, and turn order mechanics
- **`ninety-nine.cardgame.json`** — an accumulation game demonstrating custom variables (`get_var`, `set_var`, `inc_var`), conditional card effects with `if()`, and turn reversal
- **`uno.cardgame.json`** — a shedding game demonstrating `play_card` action effects, custom variables for color choice, declare with params, Skip/Reverse/Draw Two effects, and multi-phase Wild card flow

Rulesets support optional catalog fields (`description`, `tags`, `license`) in their `meta` block. Run `bun run catalog` to generate a `catalog.json` index of all rulesets for browsing and discovery. Run `bun run validate` to validate all rulesets against the schema.

See the [Ruleset Authoring Guide](docs/ruleset-authoring.md) for the full format specification, expression language reference, and annotated examples. The [Engine API Reference](packages/shared/README.md) documents all public functions and builtins.

## Project Status

All four implementation phases are **complete** with **913 passing tests** across shared (804), schema (15), and host (94) packages.

| Phase | Status | Tests |
|-------|--------|-------|
| Phase 1 — Engine Core | ✅ Complete | 804 |
| Phase 1.5 — Documentation | ✅ Complete | — |
| Phase 2 — Storage & Import | ✅ Complete | 94 |
| Phase 3 — Host Screens & CouchKit Integration | ✅ Complete | — |
| Phase 3.4 — Schema Package & Catalog | ✅ Complete | 15 |
| Phase 4 — Client Controller App | ✅ Complete | — |

The app builds and deploys to Android TV via `bun run build:android`. The host runs an HTTP+WebSocket server via CouchKit; phones connect by scanning a QR code displayed on the TV.

## Known Issues

- **`all_players_done` sentinel always returns true** — after any declare action the engine immediately advances through all automatic phases. Affects games where multiple players must each complete an action before the round advances.
- **Per-player zone visibility** — `isOwner` checks role membership, but since all human players share the `"player"` role, `isOwner` evaluates to true for every player viewing any player's hand zone. A player-index-based ownership check is needed.
- **JDK version after prebuild** — `expo prebuild --clean` regenerates `gradle.properties`, removing the `org.gradle.java.home` override. Must re-add JDK 17 path and `local.properties` with `sdk.dir` after each prebuild.

## License

MIT
