// ─── State Filter ──────────────────────────────────────────────────
// Produces per-player views of the game state, hiding information
// that the player shouldn't see (opponent hands, face-down cards).
// This is the security boundary for multiplayer information.

import type {
  Card,
  CardGameState,
  FilteredZoneState,
  PlayerId,
  PlayerView,
  ZoneVisibility,
} from "../types/index.js";
import { getValidActions } from "./action-validator.js";

/**
 * Creates a player-specific view of the game state.
 * Applies visibility rules from the ruleset to filter zone contents.
 * Hidden cards are replaced with null placeholders.
 */
export function createPlayerView(
  state: CardGameState,
  playerId: PlayerId
): PlayerView {
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player not found: ${playerId}`);
  }

  const player = state.players[playerIndex]!;
  const filteredZones: Record<string, FilteredZoneState> = {};

  for (const [zoneName, zoneState] of Object.entries(state.zones)) {
    filteredZones[zoneName] = filterZone(
      zoneName,
      zoneState.cards,
      zoneState.definition.visibility,
      player.role,
      zoneState.definition.owners
    );
  }

  const validActions = getValidActions(state, playerId);

  return {
    sessionId: state.sessionId,
    status: state.status,
    players: state.players,
    zones: filteredZones,
    currentPhase: state.currentPhase,
    isMyTurn: state.currentPlayerIndex === playerIndex,
    myPlayerId: playerId,
    validActions: validActions
      .filter((a) => a.enabled)
      .map((a) => a.kind),
    scores: state.scores,
    turnNumber: state.turnNumber,
  };
}

/**
 * Applies visibility rules to a zone's cards.
 * Returns a FilteredZoneState where hidden cards become null.
 */
function filterZone(
  name: string,
  cards: readonly Card[],
  visibility: ZoneVisibility,
  playerRole: string,
  zoneOwners: readonly string[]
): FilteredZoneState {
  const isOwner = zoneOwners.includes(playerRole);

  switch (visibility.kind) {
    case "public":
      return { name, cards: [...cards], cardCount: cards.length };

    case "owner_only":
      return isOwner
        ? { name, cards: [...cards], cardCount: cards.length }
        : { name, cards: cards.map(() => null), cardCount: cards.length };

    case "hidden":
      return { name, cards: cards.map(() => null), cardCount: cards.length };

    case "partial":
      // TODO: Evaluate partial visibility rule expression
      return { name, cards: cards.map(() => null), cardCount: cards.length };
  }
}
