// ─── Playing Screen ────────────────────────────────────────────────
// Main gameplay screen composing GameInfo, HandViewer, and ActionBar.
// State and derivations live in `usePlayingScreenModel`; shared piles
// (discard, deck) render compactly via CompactZones, with the full
// discard pile available in DiscardPileModal.

import type React from "react";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { HostAction, PlayerView, ValidAction } from "@card-engine/shared";
import { usePlayingScreenModel } from "../hooks/usePlayingScreenModel.js";
import { GameInfo } from "../components/GameInfo.js";
import { HandViewer } from "../components/HandViewer.js";
import { ActionBar } from "../components/ActionBar.js";
import { RoundResultsBanner } from "../components/RoundResultsBanner.js";
import { OpponentInfo } from "../components/OpponentInfo.js";
import { CompactZones } from "../components/CompactZones.js";
import { DiscardPileModal } from "../components/DiscardPileModal.js";

interface PlayingScreenProps {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly sendAction: (action: HostAction) => void;
  readonly playableCardIds: ReadonlySet<string>;
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
  playableCardIds,
}: PlayingScreenProps): React.JSX.Element {
  const model = usePlayingScreenModel({ playerView, validActions, sendAction });
  const [discardModalOpen, setDiscardModalOpen] = useState(false);

  return (
    <div style={containerStyle}>
      <GameInfo playerView={playerView} turnPulse={model.turnPulse} />
      <OpponentInfo playerView={playerView} />

      {model.hasCompactZones && (
        <CompactZones
          discardZone={model.discardZone}
          discardCards={model.discardCards}
          deckZone={model.deckZone}
          deckZoneName={model.deckZoneName}
          onOpenDiscard={() => setDiscardModalOpen(true)}
        />
      )}

      <HandViewer
        playerView={model.handPlayerView}
        onCardSelect={model.showCardSelection ? model.handleCardSelect : undefined}
        selectedCardId={model.selectedCard?.cardId}
        playableCardIds={model.highlightPlayable ? playableCardIds : undefined}
      />
      <ActionBar
        playerView={playerView}
        validActions={validActions}
        playerId={playerView.myPlayerId}
        sendAction={model.handleSendAction}
        selectedCard={model.selectedCard}
      />
      {model.isRoundEnd && (
        <RoundResultsBanner
          result={model.myResult}
          playerScore={model.myScore}
          opponentScores={model.npcScores}
          onNewRound={model.handleNewRound}
        />
      )}

      {discardModalOpen && (
        <DiscardPileModal cards={model.discardCards} onClose={() => setDiscardModalOpen(false)} />
      )}
    </div>
  );
}
