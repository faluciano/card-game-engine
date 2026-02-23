// ─── State Filter ──────────────────────────────────────────────────
// Produces per-player views of the game state, hiding information
// that the player shouldn't see (opponent hands, face-down cards).
// This is the security boundary for multiplayer information.

import type {
  Card,
  CardGameAction,
  CardGameState,
  FilteredZoneState,
  PlayerId,
  PlayerView,
  VisibilityRule,
  ZoneVisibility,
} from "../types/index";
import { getValidActions } from "./action-validator";

/**
 * Resolves the effective visibility for a zone, accounting for
 * phase-based overrides defined in the ruleset's visibility rules.
 */
function getEffectiveVisibility(
  zoneName: string,
  defaultVisibility: ZoneVisibility,
  visibilityRules: readonly VisibilityRule[],
  currentPhase: string
): ZoneVisibility {
  const rule = visibilityRules.find((r) => r.zone === zoneName);
  if (rule?.phaseOverride && rule.phaseOverride.phase === currentPhase) {
    return rule.phaseOverride.visibility;
  }
  return defaultVisibility;
}

/** Determines if a player can act in the current phase. */
function isPlayerActive(state: CardGameState, playerIndex: number): boolean {
  const phase = state.ruleset.phases.find(
    (p) => p.name === state.currentPhase
  );
  if (phase?.kind === "all_players") return true;
  return state.currentPlayerIndex === playerIndex;
}

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
  const visibilityRules = state.ruleset.visibility;

  for (const [zoneName, zoneState] of Object.entries(state.zones)) {
    const effectiveVisibility = getEffectiveVisibility(
      zoneName,
      zoneState.definition.visibility,
      visibilityRules,
      state.currentPhase
    );

    filteredZones[zoneName] = filterZone(
      zoneName,
      zoneState.cards,
      effectiveVisibility,
      player.role,
      zoneState.definition.owners
    );
  }

  const validActions = getValidActions(state, playerId);

  // Remap engine-internal score keys (player:N, result:N) to PlayerId keys
  // so client components can look up scores by player.id directly.
  const remappedScores: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.scores)) {
    const playerMatch = key.match(/^(?:player|result):(\d+)$/);
    if (!playerMatch) {
      // Non-player keys (e.g. "dealer") pass through unchanged
      remappedScores[key] = value;
      continue;
    }
    const index = Number(playerMatch[1]);
    const matchedPlayer = state.players[index];
    if (!matchedPlayer) continue;

    if (key.startsWith("player:")) {
      remappedScores[matchedPlayer.id] = value;
    } else {
      remappedScores[`result:${matchedPlayer.id}`] = value;
    }
  }

  return {
    sessionId: state.sessionId,
    status: state.status,
    players: state.players,
    zones: filteredZones,
    currentPhase: state.currentPhase,
    isMyTurn: isPlayerActive(state, playerIndex),
    myPlayerId: playerId,
    validActions: validActions
      .filter((a) => a.enabled)
      .map((a) => a.actionName as CardGameAction["kind"]),
    scores: remappedScores,
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
      return {
        name,
        cards: applyPartialRule(cards, visibility.rule),
        cardCount: cards.length,
      };
  }
}

/**
 * Applies a partial visibility rule to a card array.
 * Returns cards with hidden positions replaced by null.
 * Unknown rules default to fully hidden (conservative).
 */
function applyPartialRule(
  cards: readonly Card[],
  rule: string
): readonly (Card | null)[] {
  switch (rule) {
    case "first_card_only":
      return cards.map((card, i) => (i === 0 ? card : null));

    case "last_card_only":
      return cards.map((card, i) => (i === cards.length - 1 ? card : null));

    case "face_up_only":
      return cards.map((card) => (card.faceUp ? card : null));

    default:
      // Unknown rule — hide everything as a conservative default
      return cards.map(() => null);
  }
}
