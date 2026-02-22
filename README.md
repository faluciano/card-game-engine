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
   |  op-sqlite       |                               |                  |
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
- **Safe expression language** — conditions and effects use a constrained (non-Turing-complete) evaluator
- **8 query builtins + 10 effect builtins** — covering common card game mechanics (draw, discard, shuffle, score, etc.)
- **Phase-based FSM** — supports automatic, player_action, and simultaneous phase types
- **Seeded PRNG** — mulberry32 enables deterministic replay from an action log
- **Hidden information** — per-player state filtering via `createPlayerView`
- **Zod schema validation** — rulesets are validated against a strict schema at load time
- **3 deck presets** — `standard52`, `standard54`, `uno108`

## Project Structure

```
card-game-engine/
├── packages/
│   ├── shared/        @card-engine/shared   — game engine core (types, expression
│   │                                          evaluator, interpreter, PRNG)
│   ├── host/          @card-engine/host     — Android TV app (Expo + CouchKit host
│   │                                          + op-sqlite storage)
│   └── client/        @card-engine/client   — phone controller (Vite + React +
│                                              CouchKit client)
├── rulesets/          .cardgame.json rule files
├── package.json       Bun monorepo root (workspaces)
└── tsconfig.json      composite TS project references
```

| Package | Runtime | Key Dependencies |
|---------|---------|------------------|
| `shared` | Pure TypeScript, zero framework deps | Zod |
| `host` | Expo + react-native-tvos | CouchKit host, op-sqlite |
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

Tests live in the shared and host packages and use Vitest:

```sh
cd packages/shared
bunx vitest run
```

498 tests across 15 test files cover the engine core (expression evaluator, interpreter, PRNG, schema validation, player views, game phases, host bridge) and the host package (storage, importers). The client package is verified via `tsc` type-checking and Vite production build.

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

## Rulesets

A `.cardgame.json` file declaratively defines everything the engine needs to run a card game: metadata, deck composition, zones, roles, phases (FSM), scoring, visibility rules, and UI hints.

The [`rulesets/`](rulesets/) directory contains example rulesets. **`blackjack.cardgame.json`** is the reference implementation demonstrating the full format.

See the [Ruleset Authoring Guide](docs/ruleset-authoring.md) for the full format specification, expression language reference, and annotated examples. The [Engine API Reference](packages/shared/README.md) documents all public functions and builtins.

## Project Status

**Phase 1 (Engine Core)** is complete. The shared package provides a fully tested, deterministic game engine capable of loading rulesets and running games to completion.

**Phase 2 (Storage & Import)** is complete. The host package has SQLite persistence (rulesets, sessions, action log) and file/URL importers with 79 unit tests.

**Phase 3 (Host Screens & CouchKit Integration)** is complete. The host app has a bridge layer reconciling CouchKit with the card engine, three implemented screens (RulesetPicker, Lobby, GameTable), and an orchestrator hook for automatic game lifecycle management.

**Phase 4 (Client Controller App)** is complete. The phone controller has 5 screens (Connecting, Waiting, Lobby, Playing, Result) and 4 components (CardMini, HandViewer, ActionBar, GameInfo) wired to CouchKit via `useGameClient` with the shared bridge layer. Production build: 64 modules, 245.89 kB JS (72.20 kB gzip).

## License

MIT
