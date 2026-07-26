// ─── Client View ───────────────────────────────────────────────────
// What one player is allowed to receive.
//
// The host used to broadcast the whole `HostGameState` — every hand included —
// and the controller filtered it for display. That made hidden information a
// convention the client could ignore: any player could read opponents' cards
// out of devtools. This projection is the rule instead: cards a player may not
// see never reach their device.
//
// It carries affordances (`validActions`, `playableCardIds`) as well as state,
// because those are *derived from* hidden information — `getValidActions` needs
// the full `CardGameState`, which a projected client no longer has. The host is
// authoritative about what you may do, not only about what you may see.

import type { IPlayer } from "@couch-kit/core";
import type { CardGameRuleset, CardGameState, PlayerId, PlayerView } from "../types/index";
import { createPlayerView } from "../engine/state-filter";
import {
  getValidActions,
  getPlayableCardIndices,
  type ValidAction,
} from "../engine/action-validator";
import type { HostGameState, InstalledGame } from "./host-state";

/** Ruleset identity, without shipping the whole ruleset to every phone. */
export interface RulesetSummary {
  readonly slug: string;
  readonly name: string;
  readonly version: string;
}

/** Screen navigation, carrying only the ruleset fields a controller reads. */
export type ClientScreen =
  | { readonly tag: "ruleset_picker" }
  | { readonly tag: "lobby"; readonly ruleset: RulesetSummary }
  | { readonly tag: "game_table"; readonly ruleset: RulesetSummary };

/**
 * The per-player projection of {@link HostGameState}.
 *
 * Shaped to satisfy CouchKit's `IGameState` (status + players) so it can be the
 * client's state type. Notably absent: `engineState`. A controller works from
 * `playerView` and the affordances beside it.
 */
export interface HostClientView {
  readonly status: string;
  readonly players: Record<string, IPlayer>;
  readonly screen: ClientScreen;
  readonly installedSlugs: readonly InstalledGame[];
  /** Only the slug: the controller shows progress, it does not need the ruleset. */
  readonly pendingInstall: { readonly slug: string } | null;
  readonly pendingUninstall: string | null;
  readonly actionError?: {
    readonly playerId: string;
    readonly reason: string;
    readonly timestamp: number;
  } | null;
  /** Filtered engine state, or null before a game starts. */
  readonly playerView: PlayerView | null;
  /** What this player may legally do right now. */
  readonly validActions: readonly ValidAction[];
  /** Ids of the player's own cards that are currently playable. */
  readonly playableCardIds: readonly string[];
}

/** A view for a client that has not received state yet. */
export const EMPTY_CLIENT_VIEW: HostClientView = {
  status: "lobby",
  players: {},
  screen: { tag: "ruleset_picker" },
  installedSlugs: [],
  pendingInstall: null,
  pendingUninstall: null,
  actionError: null,
  playerView: null,
  validActions: [],
  playableCardIds: [],
};

function summarize(ruleset: CardGameRuleset): RulesetSummary {
  return {
    slug: ruleset.meta.slug,
    name: ruleset.meta.name,
    version: ruleset.meta.version,
  };
}

function projectScreen(screen: HostGameState["screen"]): ClientScreen {
  switch (screen.tag) {
    case "ruleset_picker":
      return { tag: "ruleset_picker" };
    case "lobby":
      return { tag: "lobby", ruleset: summarize(screen.ruleset) };
    case "game_table":
      return { tag: "game_table", ruleset: summarize(screen.ruleset) };
  }
}

/** Playable ids from the player's own hand, or empty when not applicable. */
function playableCards(
  engineState: CardGameState,
  playerId: PlayerId,
): readonly string[] {
  const playerIndex = engineState.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) return [];

  const handZone = engineState.zones[`hand:${playerIndex}`];
  if (!handZone) return [];

  const ids: string[] = [];
  for (const index of getPlayableCardIndices(
    engineState,
    engineState.ruleset,
    playerIndex,
  )) {
    const card = handZone.cards[index];
    if (card) ids.push(card.id);
  }
  return ids;
}

/**
 * Projects host state for one player. Pass to `GameHostRuntimeConfig.project`.
 *
 * Everything derived from hidden information is computed here, on the host,
 * where the full state legitimately exists.
 */
export function createHostClientView(
  state: HostGameState,
  playerId: string,
): HostClientView {
  const base = {
    status: state.status,
    players: state.players,
    screen: projectScreen(state.screen),
    installedSlugs: state.installedSlugs,
    pendingInstall: state.pendingInstall
      ? { slug: state.pendingInstall.slug }
      : null,
    pendingUninstall: state.pendingUninstall,
    actionError: state.actionError ?? null,
  };

  const engineState = state.engineState;
  if (!engineState) {
    return { ...base, playerView: null, validActions: [], playableCardIds: [] };
  }

  // Someone the engine does not know (a spectator, or a phone that joined
  // before the deal) gets no engine view rather than somebody else's.
  const id = playerId as PlayerId;
  try {
    return {
      ...base,
      playerView: createPlayerView(engineState, id),
      validActions: getValidActions(engineState, id),
      playableCardIds: playableCards(engineState, id),
    };
  } catch {
    return { ...base, playerView: null, validActions: [], playableCardIds: [] };
  }
}
