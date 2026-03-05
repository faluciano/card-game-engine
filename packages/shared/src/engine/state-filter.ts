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
  VariableDefinition,
  ZoneDefinition,
  ZoneVisibility,
} from "../types/index";
import { getValidActions } from "./action-validator";

/**
 * Resolves the effective visibility for a zone, accounting for
 * phase-based overrides defined on the zone definition.
 */
function getEffectiveVisibility(
  zoneName: string,
  zoneDefinition: ZoneDefinition,
  currentPhase: string
): ZoneVisibility {
  if (zoneDefinition.phaseOverrides) {
    const override = zoneDefinition.phaseOverrides.find(
      (o) => o.phase === currentPhase
    );
    if (override) return override.visibility;
  }
  return zoneDefinition.visibility;
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
 * Extracts public variable names from the unified manifest.
 * Returns undefined if no variables explicitly set `public`
 * (backward-compatible expose-all behavior).
 * If any variable has an explicit `public` field, filtering mode activates
 * and only those with `public: true` are exposed.
 */
function getPublicVarNames(
  manifest: Readonly<Record<string, VariableDefinition>> | undefined
): string[] | undefined {
  if (!manifest) return undefined;
  const entries = Object.entries(manifest);
  // Check if any variable has the `public` field explicitly set
  const hasExplicitPublic = entries.some(([_, def]) => def.public !== undefined);
  if (!hasExplicitPublic) return undefined;
  const names: string[] = [];
  for (const [key, def] of entries) {
    if (def.public) names.push(key);
  }
  return names;
}

/**
 * Filters numeric variables to only include those named in publicVariables.
 * If publicVariables is undefined, all variables pass through (backward compatible).
 */
function filterVariables(
  variables: Readonly<Record<string, number>>,
  publicVariables: readonly string[] | undefined
): Readonly<Record<string, number>> {
  if (!publicVariables) return variables;
  const filtered: Record<string, number> = {};
  for (const name of publicVariables) {
    if (name in variables) {
      filtered[name] = variables[name]!;
    }
  }
  return filtered;
}

/**
 * Filters string variables to only include those named in publicVariables.
 * If publicVariables is undefined, all variables pass through (backward compatible).
 */
function filterStringVariables(
  variables: Readonly<Record<string, string>>,
  publicVariables: readonly string[] | undefined
): Readonly<Record<string, string>> {
  if (!publicVariables) return variables;
  const filtered: Record<string, string> = {};
  for (const name of publicVariables) {
    if (name in variables) {
      filtered[name] = variables[name]!;
    }
  }
  return filtered;
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

  for (const [zoneName, zoneState] of Object.entries(state.zones)) {
    const effectiveVisibility = getEffectiveVisibility(
      zoneName,
      zoneState.definition,
      state.currentPhase
    );

    filteredZones[zoneName] = filterZone(
      zoneName,
      zoneState.cards,
      effectiveVisibility,
      player.role,
      playerIndex,
      zoneState.definition.owners
    );
  }

  const validActions = getValidActions(state, playerId);

  // Remap engine-internal score keys (player:N, result:N) to PlayerId keys
  // so client components can look up scores by player.id directly.
  const remappedScores: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.scores)) {
    const playerMatch = key.match(/^(?:player_score|result):(\d+)$/);
    if (!playerMatch) {
      // Non-player keys (e.g. "dealer_score") pass through unchanged
      remappedScores[key] = value;
      continue;
    }
    const index = Number(playerMatch[1]);
    const matchedPlayer = state.players[index];
    if (!matchedPlayer) continue;

    if (key.startsWith("player_score:")) {
      remappedScores[matchedPlayer.id] = value;
    } else {
      remappedScores[`result:${matchedPlayer.id}`] = value;
    }
  }

  const publicVars = getPublicVarNames(state.ruleset.variables);

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
    variables: filterVariables(state.variables, publicVars),
    stringVariables: filterStringVariables(state.stringVariables, publicVars),
    turnNumber: state.turnNumber,
    ui: state.ruleset.ui,
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
  playerIndex: number,
  zoneOwners: readonly string[]
): FilteredZoneState {
  const perPlayerMatch = name.match(/:(\d+)$/);
  const isOwner = perPlayerMatch
    ? Number(perPlayerMatch[1]) === playerIndex
    : zoneOwners.includes(playerRole);

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
