// ─── Screen Router (web) ───────────────────────────────────────────
// Mirrors the host's ScreenRouter: switches on `state.screen.tag`, the
// single source of navigation truth shared by every connected client.

import React from "react";
import type { HostAction, HostGameState } from "@card-engine/shared";
import { Lobby } from "./screens/Lobby.js";
import { RulesetPicker } from "./screens/RulesetPicker.js";
import { GameTable } from "./screens/GameTable.js";

export function ScreenRouter({
  state,
  dispatch,
  joinUrl,
  roomId,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
  readonly joinUrl: string | null;
  readonly roomId: string | null;
}): React.JSX.Element {
  switch (state.screen.tag) {
    case "ruleset_picker":
      return (
        <RulesetPicker
          state={state}
          dispatch={dispatch}
          joinUrl={joinUrl}
          roomId={roomId}
        />
      );
    case "lobby":
      return (
        <Lobby
          state={state}
          dispatch={dispatch}
          joinUrl={joinUrl}
          roomId={roomId}
        />
      );
    case "game_table":
      return <GameTable state={state} dispatch={dispatch} />;
  }
}
