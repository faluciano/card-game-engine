// ─── App ───────────────────────────────────────────────────────────
// Root component for the phone controller client.
// Gates on player name entry, then connects to the TV host via
// CouchKit's useGameClient hook. Routes screens based on connection
// status and game state.

import React, { useMemo, useState } from "react";
import {
  useGameClient,
  createRelayTransport,
  useRelayRoom,
  describeRelayError,
} from "@couch-kit/client";
import {
  hostReducer,
  createHostInitialState,
  createPlayerView,
  getValidActions,
  getPlayableCardIndices,
  type HostGameState,
  type HostAction,
  type PlayerId,
  type PlayerView,
  type ValidAction,
} from "@card-engine/shared";
import { NameEntryScreen } from "./screens/NameEntryScreen.js";
import { JoinScreen } from "./screens/JoinScreen.js";
import { ConnectingScreen } from "./screens/ConnectingScreen.js";
import { WaitingScreen } from "./screens/WaitingScreen.js";
import { CatalogScreen } from "./screens/CatalogScreen.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { PlayingScreen } from "./screens/PlayingScreen.js";
import { ResultScreen } from "./screens/ResultScreen.js";
import { Toast } from "./components/Toast.js";
import { ConnectionIndicator } from "./components/ConnectionIndicator.js";
import { ScreenTransition } from "./components/ScreenTransition.js";

const STORAGE_KEY = "ck_player_name";

const initialState = createHostInitialState();

// Relay (cross-network) opt-in. When the controller is opened with `?room=CODE`,
// it connects to the shared relay for that room instead of the default LAN
// WebSocket, letting phones join a browser display from any network.
const DEFAULT_RELAY_URL =
  import.meta.env.VITE_RELAY_URL ??
  "wss://couch-kit-relay.faluciano.workers.dev";

function readRelayUrl(): string {
  try {
    return (
      new URLSearchParams(window.location.search).get("relay") ??
      DEFAULT_RELAY_URL
    );
  } catch {
    return DEFAULT_RELAY_URL;
  }
}

function readStoredName(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
}

// ─── App (Name Gate) ───────────────────────────────────────────────

export function App(): React.JSX.Element {
  const { roomId, setRoomId } = useRelayRoom();

  // The room comes first: it is the connection prerequisite, and the client
  // must not mount without one — with no relay transport `useGameClient` falls
  // back to a LAN socket that cannot exist on a hosted controller, and those
  // retries would drown out anything this screen reports. Scanning the QR fills
  // the code in, so that path is unchanged.
  if (!roomId) return <JoinScreen onJoin={setRoomId} />;

  return <NameGate key={roomId} roomId={roomId} onRejoin={setRoomId} />;
}

// ─── Name Gate ─────────────────────────────────────────────────────

function NameGate({
  roomId,
  onRejoin,
}: {
  readonly roomId: string;
  readonly onRejoin: (code: string) => void;
}): React.JSX.Element {
  const [playerName, setPlayerName] = useState<string | null>(readStoredName);

  if (!playerName) {
    return (
      <NameEntryScreen
        onConfirm={(name) => {
          try {
            localStorage.setItem(STORAGE_KEY, name);
          } catch {
            // localStorage may be unavailable
          }
          setPlayerName(name);
        }}
      />
    );
  }

  return (
    <GameClient
      roomId={roomId}
      onRejoin={onRejoin}
      playerName={playerName}
      onChangeName={() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // localStorage may be unavailable
        }
        setPlayerName(null);
      }}
    />
  );
}

// ─── Game Client ───────────────────────────────────────────────────

interface GameClientProps {
  readonly roomId: string;
  readonly onRejoin: (code: string) => void;
  readonly playerName: string;
  readonly onChangeName: () => void;
}

function GameClient({
  roomId,
  onRejoin,
  playerName,
  onChangeName,
}: GameClientProps): React.JSX.Element {
  const url = useMemo(() => readRelayUrl(), []);
  const { status, state, playerId, sendAction, disconnectReason } =
    useGameClient<HostGameState, HostAction>({
      reducer: hostReducer,
      initialState,
      name: playerName,
      createTransport: createRelayTransport({ url, roomId }),
    });

  // A terminal relay failure (wrong or expired code, full room) is worth
  // explaining; an ordinary drop is retried and needs no screen.
  const joinError = describeRelayError(disconnectReason);

  // ── Hooks must be called unconditionally (Rules of Hooks) ──
  const playerView = useMemo((): PlayerView | null => {
    if (!state.engineState || !playerId) return null;
    try {
      return createPlayerView(state.engineState, playerId as PlayerId);
    } catch {
      return null;
    }
  }, [state.engineState, playerId]);

  const validActions = useMemo((): readonly ValidAction[] => {
    if (!state.engineState || !playerId) return [];
    try {
      return getValidActions(state.engineState, playerId as PlayerId);
    } catch {
      return [];
    }
  }, [state.engineState, playerId]);

  const playableCardIds = useMemo((): ReadonlySet<string> => {
    if (!state.engineState || !playerId) return new Set();
    try {
      const playerIndex = state.engineState.players.findIndex(
        (p) => p.id === playerId
      );
      if (playerIndex === -1) return new Set();
      const indices = getPlayableCardIndices(
        state.engineState,
        state.engineState.ruleset,
        playerIndex
      );
      const handZone = state.engineState.zones[`hand:${playerIndex}`];
      if (!handZone) return new Set();
      const ids = new Set<string>();
      for (const idx of indices) {
        const card = handZone.cards[idx];
        if (card) ids.add(card.id);
      }
      return ids;
    } catch {
      return new Set();
    }
  }, [state.engineState, playerId]);

  // ── Guards (after all hooks) ──
  // A room-level failure is terminal, so show what went wrong and let the
  // player retype the code — ConnectingScreen would spin forever.
  if (joinError) {
    return <JoinScreen onJoin={onRejoin} error={joinError} />;
  }

  if (status !== "connected" || !playerId) {
    return <ConnectingScreen status={status} />;
  }

  // ── Derive error state for Toast ──
  const actionError = state.actionError;
  const isMyError = actionError != null && actionError.playerId === playerId;

  // ── Route screens ──
  const { screen, screenKey } = (() => {
    if (state.status === "ruleset_picker") {
      return {
        screen: <CatalogScreen state={state} sendAction={sendAction} />,
        screenKey: "catalog",
      };
    }
    if (state.status === "lobby") {
      return {
        screen: (
          <LobbyScreen
            state={state}
            sendAction={sendAction}
            playerId={playerId}
            onChangeName={onChangeName}
          />
        ),
        screenKey: "lobby",
      };
    }
    if (!playerView) {
      return {
        screen: <WaitingScreen message="Loading game..." />,
        screenKey: "waiting",
      };
    }
    if (state.status === "game:finished") {
      return {
        screen: <ResultScreen playerView={playerView} />,
        screenKey: "result",
      };
    }
    return {
      screen: (
        <>
          <PlayingScreen
            playerView={playerView}
            validActions={validActions}
            sendAction={sendAction}
            playableCardIds={playableCardIds}
          />
          <Toast
            message={isMyError ? actionError.reason : null}
            triggerKey={isMyError ? actionError.timestamp : 0}
          />
        </>
      ),
      screenKey: "playing",
    };
  })();

  return (
    <>
      <ConnectionIndicator status={status} />
      <ScreenTransition key={screenKey}>{screen}</ScreenTransition>
    </>
  );
}
