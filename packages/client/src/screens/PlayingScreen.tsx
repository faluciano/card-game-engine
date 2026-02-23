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
import { RoundResultsBanner } from "../components/RoundResultsBanner.js";

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
  const isRoundEnd = playerView.currentPhase === "round_end";
  const myResult = playerView.scores[`result:${playerView.myPlayerId}`] ?? 0;
  const myScore = playerView.scores[playerView.myPlayerId] ?? 0;

  // Dynamically find NPC/opponent scores (any key ending with "_score" that isn't a player score)
  const npcScores = Object.entries(playerView.scores)
    .filter(([key]) => key.endsWith("_score"))
    .map(([key, value]) => ({
      label: key.replace(/_score$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      score: value,
    }));

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
      {isRoundEnd && (
        <RoundResultsBanner
          result={myResult}
          playerScore={myScore}
          opponentScores={npcScores}
          onNewRound={() =>
            sendAction({
              type: "GAME_ACTION",
              action: {
                kind: "declare",
                playerId: playerView.myPlayerId,
                declaration: "new_round",
              },
            })
          }
        />
      )}
    </div>
  );
}
