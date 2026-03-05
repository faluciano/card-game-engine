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
  getPlayableCardIndices,
  type HostGameState,
  type HostAction,
  type PlayerId,
  type PlayerView,
  type ValidAction,
} from "@card-engine/shared";
import { ConnectingScreen } from "./screens/ConnectingScreen.js";
import { WaitingScreen } from "./screens/WaitingScreen.js";
import { CatalogScreen } from "./screens/CatalogScreen.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { PlayingScreen } from "./screens/PlayingScreen.js";
import { ResultScreen } from "./screens/ResultScreen.js";
import { Toast } from "./components/Toast.js";

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
  if (status !== "connected" || !playerId) {
    return <ConnectingScreen status={status} />;
  }

  // Route based on game status
  if (state.status === "ruleset_picker") {
    return <CatalogScreen state={state} sendAction={sendAction} />;
  }

  if (state.status === "lobby") {
    return (
      <LobbyScreen
        state={state}
        sendAction={sendAction}
        playerId={playerId}
      />
    );
  }

  // Game states — need engineState and playerView
  if (!playerView) {
    return <WaitingScreen message="Loading game..." />;
  }

  if (state.status === "game:finished") {
    return <ResultScreen playerView={playerView} />;
  }

  // game:in_progress or game:waiting_for_players or any other game: state
  const actionError = state.actionError;
  const isMyError =
    actionError != null && actionError.playerId === playerId;

  return (
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
  );
}
