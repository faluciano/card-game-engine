# @card-engine/client

Phone controller web app for the card game engine. Players access this on their phones by scanning a QR code displayed on the TV. Built with React 18 and Vite, served to devices by CouchKit over local WiFi.

The client receives a `PlayerView` (filtered game state showing only what this player should see) from the host and renders it as a touch-friendly controller interface. Player actions are sent back to the host, which runs the authoritative game engine.

## Directory Structure

```
packages/client/
├── index.html             Vite entry point
├── vite.config.ts         Vite config (React plugin, ES2022 target)
├── tsconfig.json          Extends root, jsx: react-jsx, refs shared
├── package.json
└── src/
    ├── main.tsx            ReactDOM.createRoot entry (StrictMode)
    ├── App.tsx             Root component: GameInfo + HandViewer + ActionBar
    ├── index.ts            Barrel re-exports
    └── components/
        ├── HandViewer.tsx  Player's hand display
        ├── ActionBar.tsx   Available action buttons
        └── GameInfo.tsx    Phase, turn, scores display
```

## Components

### App

Root component that composes the three main UI sections. Will wire up `useGameClient` from `@couch-kit/client` to receive `PlayerView` from the host and pass it down to child components.

### HandViewer

Renders the player's hand from `PlayerView.zones`. Intended to display cards in a fan layout optimized for phone screens, with tap-to-select and swipe-to-play interactions.

**Data source**: `PlayerView.zones` (the player's per-player hand zone)

### ActionBar

Renders available actions from `PlayerView.validActions` as buttons. Actions are dynamically enabled or disabled based on the current game phase and whose turn it is. Dispatches `CardGameAction` objects to the host via `sendAction`.

**Data source**: `PlayerView.validActions`

### GameInfo

Compact status bar showing current phase name, whose turn it is, scores, and round number. Designed as a minimal header so the hand and actions take priority on small screens.

**Data source**: `PlayerView.currentPhase`, `PlayerView.isMyTurn`, `PlayerView.scores`

## CouchKit Client Wiring

The client connects to the host using `@couch-kit/client`. The intended integration pattern:

```typescript
import { useGameClient } from "@couch-kit/client";
import { createReducer, loadRuleset } from "@card-engine/shared";
import type { CardGameAction, PlayerView } from "@card-engine/shared";

const { state, sendAction, status, playerId } = useGameClient<PlayerView, CardGameAction>({
  reducer,
  initialState,
});
```

- `state` -- the `PlayerView` for this player, updated in real-time by the host
- `sendAction(action)` -- sends a `CardGameAction` to the host for validation and execution
- `status` -- connection status (`connecting`, `connected`, `disconnected`)
- `playerId` -- this player's assigned `PlayerId`

The host is authoritative. The client never runs the reducer locally -- it renders whatever `PlayerView` the host sends and forwards user actions back.

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

Runs `tsc` for type-checking followed by `vite build`, outputting to `dist/`.

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

All components are stubs with placeholder text and TODO comments. The component tree renders but does not yet connect to the host or display real game data.

Phase 4 will implement:

- `useGameClient` integration in `App.tsx`
- Card rendering and interaction in `HandViewer`
- Dynamic action buttons in `ActionBar`
- Live game status in `GameInfo`
- Touch gesture handling for phone screens
- Connection status indicators
