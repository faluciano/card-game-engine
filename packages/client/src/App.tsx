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
import { ConnectionIndicator } from "./components/ConnectionIndicator.js";
import { ScreenTransition } from "./components/ScreenTransition.js";

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
