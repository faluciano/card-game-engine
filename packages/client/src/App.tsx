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
  });

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

  // ── Guards (after all hooks) ──
  if (status !== "connected" || !playerId) {
    return <ConnectingScreen status={status} />;
  }

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
