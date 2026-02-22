# @card-engine/client

Phone controller web app for the card game engine. Players access this on their phones by scanning a QR code displayed on the TV. Built with React 18 and Vite, served to devices by CouchKit over local WiFi.

The client connects to the TV host via `useGameClient`, receives `HostGameState`, derives a `PlayerView` (filtered game state showing only what this player should see), and renders it as a touch-friendly controller interface. Player actions are wrapped as `HostAction` and sent back to the host, which runs the authoritative game engine.

## Directory Structure

```
packages/client/
├── index.html             Vite entry point
├── vite.config.ts         Vite config (React plugin, ES2022 target)
├── tsconfig.json          Extends root, jsx: react-jsx, refs shared
├── package.json
└── src/
    ├── main.tsx            ReactDOM.createRoot entry (StrictMode)
    ├── App.tsx             Root component: CouchKit wiring + screen router
    ├── index.ts            Barrel re-exports (all screens + components)
    ├── styles.css          Dark theme variables, CSS reset, keyframes
    ├── screens/
    │   ├── ConnectingScreen.tsx  Spinner + connection status
    │   ├── WaitingScreen.tsx     Generic waiting state with animated suits
    │   ├── LobbyScreen.tsx       Player name display while awaiting game start
    │   ├── PlayingScreen.tsx     Main gameplay (GameInfo + HandViewer + ActionBar)
    │   └── ResultScreen.tsx      Game over with winner/loser + final scores
    └── components/
        ├── CardMini.tsx    Compact card (56x80px, rank + suit or patterned back)
        ├── HandViewer.tsx  Player's hand + other visible zones
        ├── ActionBar.tsx   Available action buttons (hit, stand, etc.)
        └── GameInfo.tsx    Phase, turn, score status bar
```

## Screen Routing

`App` routes between screens based on connection status and `state.status`:

| Condition | Screen |
|-----------|--------|
| `status !== "connected"` or no `playerId` | `ConnectingScreen` |
| `state.status === "ruleset_picker"` | `WaitingScreen` ("Host is selecting a game...") |
| `state.status === "lobby"` | `LobbyScreen` |
| No `playerView` (engine not yet initialized) | `WaitingScreen` ("Loading game...") |
| `state.status === "game:finished"` | `ResultScreen` |
| Any other `game:*` status | `PlayingScreen` |

## Screens

### ConnectingScreen

Displays an animated spinner and connection status text. Shows "Reconnecting..." subtitle for `disconnected` or `error` states.

**Props**: `status: "connecting" | "connected" | "disconnected" | "error"`

### WaitingScreen

Generic waiting screen with animated card suit symbols and a configurable message. Used for pre-game states (host selecting a ruleset, engine loading).

**Props**: `message: string`

### LobbyScreen

Shows the player's assigned name and a pulsing "Waiting for host to start the game..." message.

**Props**: `playerName: string`

### PlayingScreen

Main gameplay screen composing the three core components vertically: `GameInfo` (top), `HandViewer` (scrollable middle), `ActionBar` (bottom). Receives the player view, valid actions, and a `sendAction` callback.

**Props**: `playerView: PlayerView`, `validActions: readonly ValidAction[]`, `sendAction: (action: HostAction) => void`

### ResultScreen

Game over display showing "You Win!" / "[Name] Wins" / "Draw" with color-coded results (green for win, red for loss, muted for draw). Lists all players' final scores with the current player's row highlighted.

**Props**: `playerView: PlayerView`

## Components

### CardMini

Compact 56x80px card display. Face-up cards show rank and suit symbol with red/black coloring. Face-down or hidden (`null`) cards render a patterned blue back. Uses `aria-label` for accessibility.

**Props**: `card: Card | null`

### HandViewer

Renders the player's hand zone first ("Your Hand"), then other visible zones with cards (community cards, discard pile, etc.). Excludes draw piles. Zones are labeled with formatted names (`hand_0` -> "Hand", `discard_pile` -> "Discard Pile"). Shows "No cards dealt yet" when empty.

**Props**: `playerView: PlayerView`

### ActionBar

Renders action buttons from the engine's `ValidAction` list. Each button sends a `GAME_ACTION` host action wrapping a `declare` engine action. Buttons are styled as enabled (accent purple) or disabled (dim, non-interactive). Includes press feedback via pointer events scaling to 95%. Shows "Waiting for other player..." when it is not the player's turn, and "No actions available" when the action list is empty.

**Props**: `playerView: PlayerView`, `validActions: readonly ValidAction[]`, `playerId: PlayerId`, `sendAction: (action: HostAction) => void`

### GameInfo

Compact status bar with four columns: phase name (formatted), turn number, player's score, and a pulsing "Your Turn" indicator when active. Phase names are formatted from snake_case to Title Case.

**Props**: `playerView: PlayerView`

## CouchKit Client Wiring

The client connects to the host using `@couch-kit/client`. `App` initializes `useGameClient` with the shared package's `hostReducer` and `createHostInitialState`:

```typescript
import { useGameClient } from "@couch-kit/client";
import {
  hostReducer,
  createHostInitialState,
  createPlayerView,
  getValidActions,
  type HostGameState,
  type HostAction,
} from "@card-engine/shared";

const initialState = createHostInitialState();

const { status, state, playerId, sendAction } = useGameClient<
  HostGameState,
  HostAction
>({
  reducer: hostReducer,
  initialState,
});
```

- `status` -- CouchKit connection status (`"connecting"`, `"connected"`, `"disconnected"`, `"error"`)
- `state` -- the full `HostGameState` (bridge state including `engineState`, `players`, `status`)
- `playerId` -- this player's assigned ID (string)
- `sendAction(action)` -- sends a `HostAction` to the host

The client derives the player's view locally from `state.engineState` using `createPlayerView` and `getValidActions` (memoized). The host remains authoritative; the client never modifies state directly.

## Development

Start the Vite dev server with hot-reload from the monorepo root:

```sh
bun run dev:client
```

This runs `vite` in the client package with `server.host: true` on port 5173, so you can access it from a phone on the same network during development.

## Build and Deployment

### Build

```sh
bun run build:client
```

Runs `tsc` for type-checking followed by `vite build`, outputting to `dist/`. Current build output: 64 modules, 245.89 kB JS (72.20 kB gzip).

### Bundle into Host

```sh
bun run bundle:client
```

Uses `couch-kit bundle` to copy the built client assets into the host's Android assets directory (`packages/host/android/app/src/main/assets/www`). CouchKit serves these files to connected phones over local WiFi.

### Full Pipeline

```sh
bun run build:android
```

Bundles the client and launches the Expo Android build in one step.

## Current Status

Phase 4 is complete. All screens and components are fully implemented:

- CouchKit integration via `useGameClient` with `hostReducer`/`createHostInitialState` from `@card-engine/shared`
- Screen-based routing driven by `state.status` (5 screens covering the full connection and game lifecycle)
- Card rendering with face-up/face-down display and suit coloring
- Dynamic action buttons from the engine's valid action system
- Live game status bar (phase, turn, score, turn indicator)
- Game over screen with winner detection and final score display
- Dark theme with CSS custom properties and animations (spin, pulse, fadeIn, slideUp)
- Touch-optimized UI with press feedback and tap highlight suppression
- Production build passing with 64 modules at 245.89 kB (72.20 kB gzip)
