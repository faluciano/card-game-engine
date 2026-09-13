// ─── Lobby Model ───────────────────────────────────────────────────
// View-model for the waiting room shared by the TV host and the web
// display: the connected player list, the min/max count label and the
// start/back handlers. Renderers add only the QR / join panel.

import { useCallback, useMemo } from "react";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";

// ─── Types ─────────────────────────────────────────────────────────

/** A CouchKit player row with its record key as `id`. */
export type LobbyPlayer = HostGameState["players"][string];

export type LobbyModel =
  | { readonly kind: "invalid_screen"; readonly message: "Invalid screen state" }
  | {
      readonly kind: "lobby";
      readonly ruleset: CardGameRuleset;
      readonly gameName: string;
      readonly min: number;
      readonly max: number;
      readonly playerList: readonly LobbyPlayer[];
      readonly connectedCount: number;
      /** "2 / 2–4 players" */
      readonly playerCountLabel: string;
      readonly canStart: boolean;
      readonly start: () => void;
      readonly back: () => void;
    };

// ─── Pure helpers ──────────────────────────────────────────────────

/** Flattens the CouchKit player record into rows keyed by their id. */
export function toPlayerList(players: HostGameState["players"]): readonly LobbyPlayer[] {
  return Object.entries(players).map(([id, player]) => ({ ...player, id }));
}

export function countConnected(players: readonly LobbyPlayer[]): number {
  return players.filter((p) => p.connected).length;
}

export function formatPlayerCount(connected: number, min: number, max: number): string {
  return `${connected} / ${min}–${max} players`;
}

/** Avatar initial for a lobby row. */
export function playerInitial(player: LobbyPlayer): string {
  return player.name.charAt(0).toUpperCase();
}

// ─── Hook ──────────────────────────────────────────────────────────

/**
 * All hooks run unconditionally, before the screen-tag guard expressed
 * through the returned `kind`.
 */
export function useLobbyModel(
  state: HostGameState,
  dispatch: (action: HostAction) => void,
): LobbyModel {
  const ruleset = state.screen.tag === "lobby" ? state.screen.ruleset : null;
  const min = ruleset?.meta.players.min ?? 0;
  const max = ruleset?.meta.players.max ?? 0;

  const playerList = useMemo(() => toPlayerList(state.players), [state.players]);

  const connectedCount = countConnected(playerList);
  const canStart = ruleset !== null && connectedCount >= min;

  const start = useCallback(() => {
    if (!canStart) return;
    dispatch({ type: "START_GAME" });
  }, [dispatch, canStart]);

  const back = useCallback(() => {
    dispatch({ type: "BACK_TO_PICKER" });
  }, [dispatch]);

  if (ruleset === null) {
    return { kind: "invalid_screen", message: "Invalid screen state" };
  }

  return {
    kind: "lobby",
    ruleset,
    gameName: ruleset.meta.name,
    min,
    max,
    playerList,
    connectedCount,
    playerCountLabel: formatPlayerCount(connectedCount, min, max),
    canStart,
    start,
    back,
  };
}
