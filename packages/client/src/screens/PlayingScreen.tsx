// ─── Playing Screen ────────────────────────────────────────────────
// Main gameplay screen composing GameInfo, HandViewer, and ActionBar.
// Receives the player's view and a function to send actions to the host.

import React from "react";
import type { CSSProperties } from "react";
import type { PlayerView, HostAction } from "@card-engine/shared";
import { type ValidAction } from "@card-engine/shared";
import { GameInfo } from "../components/GameInfo.js";
import { HandViewer } from "../components/HandViewer.js";
import { ActionBar } from "../components/ActionBar.js";

interface PlayingScreenProps {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly sendAction: (action: HostAction) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  padding: 16,
  gap: 12,
  animation: "fadeIn 0.3s ease-out",
};

export function PlayingScreen({
  playerView,
  validActions,
  sendAction,
}: PlayingScreenProps): React.JSX.Element {
  return (
    <div style={containerStyle}>
      <GameInfo playerView={playerView} />
      <HandViewer playerView={playerView} />
      <ActionBar
        playerView={playerView}
        validActions={validActions}
        playerId={playerView.myPlayerId}
        sendAction={sendAction}
      />
    </div>
  );
}
