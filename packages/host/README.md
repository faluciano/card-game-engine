# @card-engine/host

Android TV host application for the card game engine. Runs as the authoritative game server and shared table display on a TV, managing game state, persisting sessions to local SQLite, and serving player views over local WiFi via CouchKit.

Players connect their phones by scanning a QR code displayed on the TV. The host loads a `.cardgame.json` ruleset, runs the engine's reducer for every action, and broadcasts filtered per-player state back to each connected client.

> The storage and import layers are fully implemented with 79 unit tests. Screen components are currently stubbed — implementation is planned for Phase 3.

## Directory Structure

```
packages/host/
├── android/                  Native Android TV project (Expo prebuild)
├── src/
│   ├── __mocks__/
│   │   ├── expo-file-system.ts  Test mock for expo-file-system
│   │   └── op-sqlite.ts         Test mock for op-sqlite DB interface
│   ├── import/
│   │   ├── file-importer.ts     Import .cardgame.json from local file
│   │   ├── url-importer.ts      Import .cardgame.json from HTTPS URL
│   │   ├── format-zod-issues.ts Human-readable Zod error formatting
│   │   ├── *.test.ts            Unit tests (10 + 14 + 8 tests)
│   │   └── index.ts
│   ├── screens/
│   │   ├── RulesetPicker.tsx    Game selection screen (stub)
│   │   ├── Lobby.tsx            Player waiting room with QR code (stub)
│   │   └── GameTable.tsx        Main TV display during gameplay (stub)
│   ├── storage/
│   │   ├── migrations.ts        SQLite schema (3 tables, versioned)
│   │   ├── ruleset-store.ts     Ruleset CRUD with gzip compression
│   │   ├── session-store.ts     Game state snapshot persistence
│   │   ├── action-logger.ts     Append-only action log for replay
│   │   ├── *.test.ts            Unit tests (15 + 12 + 11 + 9 tests)
│   │   └── index.ts
│   └── index.ts                 Public API re-exports
├── vitest.config.ts             Test config with native module aliases
├── app.json                     Expo config (landscape, dark, new arch)
├── package.json
└── tsconfig.json
```

## Screen Architecture

The host app follows a linear screen flow with back-navigation:

```
RulesetPicker  -->  Lobby  -->  GameTable
     ^                |              |
     |                v              v
     +---- (back) ----+----- (back) -+
```

### RulesetPicker

Entry screen. Lists all locally stored rulesets with name, author, and player count. Provides import actions (file picker or URL input) to add new rulesets. Selecting a ruleset navigates to the Lobby.

### Lobby

Waiting room displayed after a ruleset is selected. Shows a QR code generated from CouchKit's `serverUrl` for players to scan and connect. Displays the list of connected players with role assignments. The "Start Game" button enables once the minimum player count defined in the ruleset is reached.

### GameTable

The primary gameplay screen rendered on the TV. Subscribes to game state from the engine and renders the public view: shared zones (draw pile, discard), current phase and turn indicator, scores, and card animations. Individual player hands and hidden information are never shown on this screen -- those are sent to each player's phone via CouchKit.

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

79 tests across 7 test files:

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `migrations.test.ts` | 15 | Migration runner, meta table, multi-statement SQL |
| `ruleset-store.test.ts` | 12 | CRUD, pako compression round-trip, guards |
| `session-store.test.ts` | 11 | Snapshot save/load, cascade delete, upsert |
| `action-logger.test.ts` | 9 | Append, query with version filter, count |
| `file-importer.test.ts` | 10 | Extension guard, file read, JSON parse, validation |
| `url-importer.test.ts` | 14 | HTTPS guard, size limits, fetch errors, validation |
| `format-zod-issues.test.ts` | 8 | Path formatting, root issues, nested paths |

Tests use constructor-injected mock DB instances (no `vi.mock` for storage) and real pako compression for round-trip verification.

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
| `RulesetPicker` | Stub — placeholder JSX |
| `Lobby` | Stub — placeholder JSX |
| `GameTable` | Stub — placeholder JSX |
| CouchKit integration | Not yet wired |

Phase 3 will implement screens and CouchKit integration.
