# @card-engine/host

Android TV host application for the card game engine. Runs as the authoritative game server and shared table display on a TV, managing game state, persisting sessions to local SQLite, and serving player views over local WiFi via CouchKit.

Players connect their phones by scanning a QR code displayed on the TV. The host loads a `.cardgame.json` ruleset, runs the engine's reducer for every action, and broadcasts filtered per-player state back to each connected client.

> Storage, import, bridge layer, screens, and orchestration hook are fully implemented with 79 unit tests across the storage and import layers. Screen components are React Native UI and are verified manually on-device.

## Directory Structure

```
packages/host/
├── android/                  Native Android TV project (Expo prebuild)
├── src/
│   ├── __mocks__/
│   │   ├── expo-file-system.ts  Test mock for expo-file-system
│   │   └── op-sqlite.ts         Test mock for op-sqlite DB interface
│   ├── hooks/
│   │   └── useGameOrchestrator.ts  Auto-dispatches lifecycle transitions
│   ├── import/
│   │   ├── file-importer.ts     Import .cardgame.json from local file
│   │   ├── url-importer.ts      Import .cardgame.json from HTTPS URL
│   │   ├── format-zod-issues.ts Human-readable Zod error formatting
│   │   ├── *.test.ts            Unit tests (10 + 14 + 8 tests)
│   │   └── index.ts
│   ├── reducers/
│   │   └── host-reducer.ts      Bridge reducer (CouchKit ↔ card engine)
│   ├── screens/
│   │   ├── RulesetPicker.tsx    Game selection with D-pad focus support
│   │   ├── Lobby.tsx            QR code display + player list + start gate
│   │   └── GameTable.tsx        Zone rendering, scores, results overlay
│   ├── storage/
│   │   ├── migrations.ts        SQLite schema (3 tables, versioned)
│   │   ├── ruleset-store.ts     Ruleset CRUD with gzip compression
│   │   ├── session-store.ts     Game state snapshot persistence
│   │   ├── action-logger.ts     Append-only action log for replay
│   │   ├── *.test.ts            Unit tests (15 + 12 + 11 + 9 tests)
│   │   └── index.ts
│   ├── types/
│   │   └── host-state.ts        Bridge types (HostGameState, HostAction, HostScreen)
│   ├── App.tsx                  Root: AssetGate → GameHostProvider → ServerErrorGate → ScreenRouter
│   └── index.ts                 Public API re-exports
├── vitest.config.ts             Test config with native module aliases
├── app.json                     Expo config (landscape, dark, new arch)
├── package.json
└── tsconfig.json
```

## App Architecture

The root `App.tsx` composes four layers, each guarding a precondition before rendering children:

```
App
 └─ AssetGate               Extract bundled web assets from the APK
     └─ GameHostProvider     Wire CouchKit with bridge reducer + initial state
         └─ ServerErrorGate  Show error overlay if CouchKit server fails
             └─ ScreenRouter Read state.screen.tag → render matching screen
```

`AssetGate` uses `useExtractAssets` to copy the bundled client SPA from the APK to the filesystem for CouchKit's native HTTP server. `GameHostProvider` receives the bridge reducer and initial state. `ServerErrorGate` catches server startup failures. `ScreenRouter` is an exhaustive switch on `state.screen.tag` that renders `RulesetPicker`, `Lobby`, or `GameTable`.

## Bridge Layer

CouchKit operates on a generic `IGameState` interface (Record-based players, flat string status), while the card engine uses `CardGameState` (array-based players, discriminated-union status). The bridge layer in `types/` and `reducers/` reconciles the two.

### Bridge Types (`types/host-state.ts`)

- **`HostScreen`** -- Discriminated union on `tag`: `"ruleset_picker"`, `"lobby"` (carries `ruleset` + `engineReducer`), or `"game_table"` (carries `ruleset` + `engineReducer`). Enables exhaustive switch coverage in `ScreenRouter`.
- **`HostGameState`** -- Extends `IGameState` with `screen: HostScreen` and `engineState: CardGameState | null`. CouchKit sees `status` (a flat string like `"lobby"` or `"game:in_progress"`) and `players` (a Record), while screens read the structured `screen` and `engineState` fields.
- **`HostAction`** -- Discriminated union on `type` (not `kind`, because CouchKit's `IAction` requires `type: string`): `SELECT_RULESET`, `BACK_TO_PICKER`, `START_GAME`, `GAME_ACTION`, `RESET_ROUND`, `ADVANCE_PHASE`.

### Bridge Reducer (`reducers/host-reducer.ts`)

The reducer handles host-level navigation and delegates in-game actions to the engine:

1. **`SELECT_RULESET`** -- Creates the engine reducer via `createReducer(ruleset)`, transitions to the lobby screen.
2. **`BACK_TO_PICKER`** -- Resets to the ruleset picker, clears engine state.
3. **`START_GAME`** -- Maps CouchKit's `Record<string, IPlayer>` to the engine's `Player[]`, creates initial engine state via `createInitialState`, transitions to the game table.
4. **`GAME_ACTION`** -- Delegates to the engine reducer, updates `engineState`.
5. **`RESET_ROUND`** / **`ADVANCE_PHASE`** -- Forward lifecycle actions to the engine reducer.

Status is derived from screen tag and engine state kind (e.g., `"game:in_progress"`), exposed as a flat string for CouchKit broadcasting.

## Screen Flow

The host app follows a linear screen flow with back-navigation:

```
RulesetPicker  -->  Lobby  -->  GameTable
     ^                |              |
     |                v              v
     +---- (back) ----+----- (back) -+
```

### RulesetPicker

Entry screen. Displays a grid of available rulesets showing name, author, player count, and version. Ships with a built-in blackjack ruleset parsed at module level via `loadRuleset`. An "Import Ruleset" placeholder button is rendered with dashed-border styling -- wiring to `FileImporter` / `URLImporter` is planned for a future integration pass.

All interactive elements use `Pressable` with `onFocus`/`onBlur` handlers and visible focus rings (`borderColor: #7c4dff`) for D-pad navigation. The first ruleset card receives `hasTVPreferredFocus` for automatic initial focus.

### Lobby

Waiting room displayed after a ruleset is selected. The screen is split into two panels:

- **Left panel** -- QR code display (currently a text placeholder; `react-native-qrcode-skia` is installed as a dependency), game name, and connection hint. The QR encodes CouchKit's `serverUrl`.
- **Right panel** -- Connected player list with avatar circles (first letter of name), disconnected badges, and a player count indicator (`N / min–max players`). "Start Game" button enables once `connectedCount >= ruleset.meta.players.min`. "Back" returns to the picker.

### GameTable

The primary gameplay screen rendered on the TV. Uses a green felt-style background (`#0d3320`). Components:

- **StatusBar** -- Horizontal bar showing current phase name, status label, active player's turn indicator (yellow highlight), and round number.
- **SharedZones** -- Renders shared zones (draw pile, discard) with card faces. Face-up cards show rank and suit (with red coloring for hearts/diamonds). Face-down cards show a card back glyph.
- **PlayerZones** -- Groups per-player zones under each player's name. Active turn is indicated with a yellow dot and "TURN" label.
- **ScoreBoard** -- Displays player scores when present in the engine state.
- **ResultsOverlay** -- Semi-transparent overlay shown when the game finishes. Shows the winner (or "It's a draw!") and offers "New Round" and "Back to Menu" buttons with D-pad focus support.

## Orchestrator Hook

`useGameOrchestrator(state, dispatch)` watches engine state transitions and auto-dispatches host-only actions. Currently handles one transition:

- **Game finished → auto reset** -- When `engineState.status.kind` becomes `"finished"`, the results overlay is shown for 5 seconds, then a `RESET_ROUND` action is dispatched to start a new round. The timer is cleared if the state changes before it fires (e.g., the user manually presses "New Round" or "Back to Menu").

The hook is called inside `GameTable` and uses a ref-based timer with careful cleanup on state changes and unmount.

## Storage Layer

Local persistence uses [op-sqlite](https://github.com/nicholasgasior/op-engineering/op-sqlite) for SQLite access and [pako](https://github.com/nicholasgasior/pako) for gzip compression. All JSON game data (rulesets, state snapshots, actions) is compressed before storage to reduce disk usage.

### SQLite Schema

Three tables defined in `migrations.ts`, applied via versioned idempotent migrations:

**`rulesets`** -- Imported game definitions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT PK` | Unique ruleset identifier |
| `slug` | `TEXT UNIQUE` | URL-safe short name |
| `compressed_data` | `BLOB` | Gzipped JSON (`CardGameRuleset`) |
| `imported_at` | `INTEGER` | Unix timestamp |
| `last_played_at` | `INTEGER` | Nullable, updated on game start |

**`sessions`** -- Game state snapshots for crash recovery.

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | `TEXT PK` | Unique session identifier |
| `compressed_state` | `BLOB` | Gzipped JSON (`CardGameState`) |
| `saved_at` | `INTEGER` | Unix timestamp |

**`action_log`** -- Append-only log for replay and undo.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `INTEGER PK` | Auto-increment |
| `session_id` | `TEXT FK` | References `sessions.session_id` |
| `version` | `INTEGER` | Monotonic action sequence number |
| `action_json` | `TEXT` | Serialized `ResolvedAction` |
| `timestamp` | `INTEGER` | Indexed for range queries |

Index: `idx_action_log_session` on `(session_id, version)`.

### Store Classes

- **`RulesetStore`** -- CRUD for rulesets. Compresses with `pako.gzip` on write, decompresses with `pako.ungzip` on read. Methods: `list()`, `getById(id)`, `save(ruleset)`, `delete(id)`.
- **`SessionStore`** -- Snapshot persistence for crash recovery. Saves compressed state at phase transitions or every N actions. Methods: `saveSnapshot(state)`, `loadSnapshot(sessionId)`, `listSessions()`, `deleteSession(sessionId)`.
- **`ActionLogger`** -- Append-only action log. Actions are never modified or deleted during a game session. Enables deterministic replay by re-applying actions from a snapshot. Methods: `append(sessionId, action)`, `getActions(sessionId, fromVersion?)`, `getActionCount(sessionId)`.

## Import System

Two importers bring `.cardgame.json` rulesets into local storage:

- **`importFromFile(filePath)`** -- Reads a local file. Validates the `.cardgame.json` extension, parses JSON, and validates against the ruleset schema from `@card-engine/shared`.
- **`importFromUrl(url, maxSizeBytes?)`** -- Fetches from an HTTPS URL (HTTP is rejected). Enforces a size limit (default 1 MB). Parses and validates the response body.

Both return a discriminated union result: `{ ok: true, ruleset }` or `{ ok: false, error }`.

## CouchKit Wiring

The host app uses [CouchKit](https://github.com/nicholasgasior/couch-kit) for local WiFi networking between the TV and connected phones. The intended integration pattern:

```tsx
import { GameHostProvider, useGameHost } from "@couch-kit/host";
import { createReducer, createInitialState } from "@card-engine/shared";

// Wrap the app with GameHostProvider, passing the engine's reducer
// and initial state. CouchKit handles WebSocket server setup,
// client connections, and state synchronization.
<GameHostProvider config={{ reducer, initialState }}>
  <App />
</GameHostProvider>

// Inside screens, useGameHost() provides:
// - state:     current CardGameState
// - dispatch:  send actions to the reducer
// - serverUrl: local URL for QR code generation (e.g., "http://192.168.1.5:8080")
const { state, dispatch, serverUrl } = useGameHost();
```

The TV displays a QR code encoding `serverUrl` so phones on the same WiFi network can connect without manual configuration. CouchKit manages the WebSocket lifecycle, reconnection, and state broadcasting. The host runs `createPlayerView` from `@card-engine/shared` to filter state before sending each client their view.

## Development

### From the host package directory

```sh
# Start Expo dev server
bun run start

# Generate native Android project
bun run prebuild

# Build and run on connected Android TV / emulator
bun run android
```

### From the monorepo root

```sh
# Full pipeline: build client, bundle into host assets, run on Android
bun run build:android
```

### Prerequisites

- [Bun](https://bun.sh/) >= 1.2.19
- Android TV device or emulator with USB debugging enabled
- Android SDK with `compileSdkVersion` 34 and `buildToolsVersion` 34.0.0

### Configuration

Expo config in `app.json`:

| Setting | Value |
|---------|-------|
| Orientation | `landscape` |
| UI style | `dark` |
| New architecture | Enabled |
| Android package | `com.cardgameengine.host` |
| Target SDK | 34 |

## Testing

Run storage and import tests:

```sh
# From packages/host/
bun run test          # Run once
bun run test:watch    # Watch mode
```

79 tests across 7 test files covering the storage and import layers:

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `migrations.test.ts` | 15 | Migration runner, meta table, multi-statement SQL |
| `ruleset-store.test.ts` | 12 | CRUD, pako compression round-trip, guards |
| `session-store.test.ts` | 11 | Snapshot save/load, cascade delete, upsert |
| `action-logger.test.ts` | 9 | Append, query with version filter, count |
| `file-importer.test.ts` | 10 | Extension guard, file read, JSON parse, validation |
| `url-importer.test.ts` | 14 | HTTPS guard, size limits, fetch errors, validation |
| `format-zod-issues.test.ts` | 8 | Path formatting, root issues, nested paths |

Tests use constructor-injected mock DB instances (no `vi.mock` for storage) and real pako compression for round-trip verification. Screen components, the bridge reducer, and the orchestrator hook are React Native UI code verified manually on-device — they depend on CouchKit provider context and native modules not available in the Vitest environment.

## Current Status

| Component | Status |
|-----------|--------|
| SQLite schema (`migrations.ts`) | ✅ Implemented — 3 tables with versioned migrations |
| Migration runner (`runMigrations`) | ✅ Implemented — meta table tracking, multi-statement SQL splitting |
| `RulesetStore` | ✅ Implemented — CRUD with pako gzip compression |
| `SessionStore` | ✅ Implemented — snapshot upsert with transactional cascade delete |
| `ActionLogger` | ✅ Implemented — append-only log with version filtering |
| `importFromFile` | ✅ Implemented — expo-file-system read, Zod validation |
| `importFromUrl` | ✅ Implemented — HTTPS-only, size limits, Zod validation |
| `formatZodIssues` | ✅ Implemented — human-readable Zod error formatting |
| Unit tests | ✅ 79 tests passing across 7 files |
| Bridge types (`HostGameState`, `HostAction`, `HostScreen`) | ✅ Implemented — CouchKit ↔ card engine reconciliation |
| Bridge reducer (`hostReducer`) | ✅ Implemented — navigation, game lifecycle, engine delegation |
| `App.tsx` pipeline | ✅ Implemented — AssetGate → GameHostProvider → ServerErrorGate → ScreenRouter |
| `RulesetPicker` | ✅ Implemented — built-in blackjack, D-pad focus, import placeholder |
| `Lobby` | ✅ Implemented — QR placeholder, player list, start gate |
| `GameTable` | ✅ Implemented — zone rendering, card faces, scores, results overlay |
| `useGameOrchestrator` | ✅ Implemented — auto round reset after 5s delay |
| CouchKit integration | ✅ Wired — GameHostProvider, useGameHost, serverUrl |
