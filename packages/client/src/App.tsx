// ─── App ───────────────────────────────────────────────────────────
// Root component for the phone controller client.
// Connects to the TV host via CouchKit's useGameClient hook.
// Routes screens based on connection status and game state.

import React, { useMemo } from "react";
import { useGameClient } from "@couch-kit/client";
import {
  hostReducer,
  createHostInitialState,
  createPlayerView,
  getValidActions,
  type HostGameState,
  type HostAction,
  type PlayerId,
  type PlayerView,
  type ValidAction,
} from "@card-engine/shared";
import { ConnectingScreen } from "./screens/ConnectingScreen.js";
import { WaitingScreen } from "./screens/WaitingScreen.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { PlayingScreen } from "./screens/PlayingScreen.js";
import { ResultScreen } from "./screens/ResultScreen.js";

const initialState = createHostInitialState();

export function App(): React.JSX.Element {
  const { status, state, playerId, sendAction } = useGameClient<
    HostGameState,
    HostAction
  >({
    reducer: hostReducer,
    initialState,
    debug: true,
  });

  // Not connected yet — show connecting/error screen
  if (status !== "connected" || !playerId) {
    return <ConnectingScreen status={status} />;
  }

  // Compute player view when game is active
  const playerView = useMemo((): PlayerView | null => {
    if (!state.engineState) return null;
    return createPlayerView(state.engineState, playerId as PlayerId);
  }, [state.engineState, playerId]);

  // Compute full valid actions (with labels and enabled state) for ActionBar
  const validActions = useMemo((): readonly ValidAction[] => {
    if (!state.engineState) return [];
    return getValidActions(state.engineState, playerId as PlayerId);
  }, [state.engineState, playerId]);

  // Route based on game status
  if (state.status === "ruleset_picker") {
    return <WaitingScreen message="Host is selecting a game..." />;
  }

  if (state.status === "lobby") {
    const player = state.players[playerId];
    const playerName = player?.name ?? "Player";
    return <LobbyScreen playerName={playerName} />;
  }

  // Game states — need engineState and playerView
  if (!playerView) {
    return <WaitingScreen message="Loading game..." />;
  }

  if (state.status === "game:finished") {
    return <ResultScreen playerView={playerView} />;
  }

  // game:in_progress or game:waiting_for_players or any other game: state
  return (
    <PlayingScreen
      playerView={playerView}
      validActions={validActions}
      sendAction={sendAction}
    />
  );
}
