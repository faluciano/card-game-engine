// ─── Playing Screen ────────────────────────────────────────────────
// Main gameplay screen composing GameInfo, HandViewer, and ActionBar.
// Receives the player's view and a function to send actions to the host.
// Manages card selection state for play_card actions.

import React, { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { PlayerView, HostAction, CardInstanceId } from "@card-engine/shared";
import { type ValidAction } from "@card-engine/shared";
import { GameInfo } from "../components/GameInfo.js";
import { HandViewer } from "../components/HandViewer.js";
import { ActionBar } from "../components/ActionBar.js";
import { RoundResultsBanner } from "../components/RoundResultsBanner.js";

/** Tracks which card the player has tapped for a play_card action. */
interface SelectedCard {
  readonly cardId: CardInstanceId;
  readonly zoneName: string;
}

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

/** Returns true when any valid action requires card selection. */
function hasPlayCardAction(actions: readonly ValidAction[]): boolean {
  return actions.some((a) => a.actionName === "play_card");
}

export function PlayingScreen({
  playerView,
  validActions,
  sendAction,
}: PlayingScreenProps): React.JSX.Element {
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);

  // Clear selection when the set of available actions changes
  // (e.g., after submitting an action, turn change, phase change).
  const actionFingerprint = validActions
    .map((a) => a.actionName)
    .sort()
    .join(",");
  useEffect(() => {
    setSelectedCard(null);
  }, [actionFingerprint]);

  const handleCardSelect = useCallback(
    (cardId: CardInstanceId, zoneName: string) => {
      setSelectedCard((prev) =>
        prev?.cardId === cardId ? null : { cardId, zoneName },
      );
    },
    [],
  );

  const handleSendAction = useCallback(
    (action: HostAction) => {
      sendAction(action);
      setSelectedCard(null);
    },
    [sendAction],
  );

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

  // Only enable card selection when a play_card action is available
  const showCardSelection = hasPlayCardAction(validActions);

  return (
    <div style={containerStyle}>
      <GameInfo playerView={playerView} />
      <HandViewer
        playerView={playerView}
        onCardSelect={showCardSelection ? handleCardSelect : undefined}
        selectedCardId={selectedCard?.cardId}
      />
      <ActionBar
        playerView={playerView}
        validActions={validActions}
        playerId={playerView.myPlayerId}
        sendAction={handleSendAction}
        selectedCard={selectedCard}
      />
      {isRoundEnd && (
        <RoundResultsBanner
          result={myResult}
          playerScore={myScore}
          opponentScores={npcScores}
          onNewRound={() =>
            handleSendAction({
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
