// ─── usePlayingScreenModel ─────────────────────────────────────────
// All non-JSX state for the gameplay screen: card selection (reset when
// the valid-action set changes), the turn pulse + haptic, the compact
// pile split, round-end data and the "new round" declaration.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Card,
  CardInstanceId,
  HostAction,
  PlayerView,
  ValidAction,
} from "@card-engine/shared";
import { getNpcScoreRows, type NpcScoreRow } from "@card-engine/host-core/catalog";
import { hasPlayCardAction, type SelectedCard } from "../lib/action-bar.js";
import {
  actionFingerprint,
  pickNewRoundAction,
  splitCompactZones,
  visibleCards,
  type CompactZoneSplit,
} from "../lib/playing-screen.js";

/** How long the "your turn" pulse animation runs. */
const TURN_PULSE_MS = 2000;
/** Haptic double-pulse on turn start. */
const TURN_VIBRATION_PATTERN: readonly number[] = [100, 50, 100];

export interface PlayingScreenModelInput {
  readonly playerView: PlayerView;
  readonly validActions: readonly ValidAction[];
  readonly sendAction: (action: HostAction) => void;
}

export interface PlayingScreenModel extends CompactZoneSplit {
  readonly selectedCard: SelectedCard | null;
  readonly showCardSelection: boolean;
  readonly handleCardSelect: (cardId: CardInstanceId, zoneName: string) => void;
  readonly handleSendAction: (action: HostAction) => void;
  readonly turnPulse: boolean;
  /** PlayerView with the compact piles removed, for HandViewer. */
  readonly handPlayerView: PlayerView;
  /** Visible discard cards; index 0 is the most recently played. */
  readonly discardCards: readonly Card[];
  readonly hasCompactZones: boolean;
  readonly isRoundEnd: boolean;
  readonly myResult: number;
  readonly myScore: number;
  readonly npcScores: readonly NpcScoreRow[];
  /** Sends the round-end declaration, if the ruleset offers one. */
  readonly handleNewRound: () => void;
}

export function usePlayingScreenModel({
  playerView,
  validActions,
  sendAction,
}: PlayingScreenModelInput): PlayingScreenModel {
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null);

  // ─── Turn notification: detect false → true transition ──────────
  const prevIsMyTurnRef = useRef<boolean>(playerView.isMyTurn);
  const [turnPulse, setTurnPulse] = useState(false);

  useEffect(() => {
    const wasMyTurn = prevIsMyTurnRef.current;
    prevIsMyTurnRef.current = playerView.isMyTurn;
    if (wasMyTurn || !playerView.isMyTurn) return;

    navigator.vibrate?.([...TURN_VIBRATION_PATTERN]);
    setTurnPulse(true);
    const timer = setTimeout(() => setTurnPulse(false), TURN_PULSE_MS);
    return () => clearTimeout(timer);
  }, [playerView.isMyTurn]);

  // ─── Selection resets whenever the set of valid actions changes ──
  const fingerprint = actionFingerprint(validActions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint is the deliberate trigger — selection resets when the action set changes
  useEffect(() => {
    setSelectedCard(null);
  }, [fingerprint]);

  const handleCardSelect = useCallback((cardId: CardInstanceId, zoneName: string) => {
    setSelectedCard((prev) => (prev?.cardId === cardId ? null : { cardId, zoneName }));
  }, []);

  const handleSendAction = useCallback(
    (action: HostAction) => {
      sendAction(action);
      setSelectedCard(null);
    },
    [sendAction],
  );

  // ─── Compact piles ──────────────────────────────────────────────
  const split = useMemo(() => splitCompactZones(playerView.zones), [playerView.zones]);
  const handPlayerView = useMemo<PlayerView>(
    () => ({ ...playerView, zones: split.handZones }),
    [playerView, split.handZones],
  );
  const discardCards = useMemo(() => visibleCards(split.discardZone), [split.discardZone]);
  const hasCompactZones =
    (split.discardZone?.cardCount ?? 0) > 0 || (split.deckZone?.cardCount ?? 0) > 0;

  // ─── Round end ──────────────────────────────────────────────────
  const isRoundEnd = playerView.currentPhase === "round_end";
  const myResult = playerView.scores[`result:${playerView.myPlayerId}`] ?? 0;
  const myScore = playerView.scores[playerView.myPlayerId] ?? 0;
  const npcScores = useMemo(() => getNpcScoreRows(playerView.scores), [playerView.scores]);

  const handleNewRound = useCallback(() => {
    const action = pickNewRoundAction(validActions);
    if (action === null) return;
    handleSendAction({
      type: "GAME_ACTION",
      action: { kind: "declare", playerId: playerView.myPlayerId, declaration: action.actionName },
    });
  }, [validActions, playerView.myPlayerId, handleSendAction]);

  return {
    ...split,
    selectedCard,
    showCardSelection: hasPlayCardAction(validActions),
    handleCardSelect,
    handleSendAction,
    turnPulse,
    handPlayerView,
    discardCards,
    hasCompactZones,
    isRoundEnd,
    myResult,
    myScore,
    npcScores,
    handleNewRound,
  };
}
