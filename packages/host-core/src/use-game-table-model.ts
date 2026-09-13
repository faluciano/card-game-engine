// ─── Game Table Hooks ──────────────────────────────────────────────
// Stateful glue for the game table screen, shared by both renderers:
// the screen-level model (guards + derived sections + overlay), the
// per-zone model (expand toggle + "newly dealt" tracking) and the flip
// trigger. All hooks are unconditional so callers can early-return on
// the returned discriminant without breaking hook order.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Card,
  CardGameState,
  HostAction,
  HostGameState,
  ZoneState,
} from "@card-engine/shared";
import {
  DEAL_MARK_CLEAR_MS,
  getActiveSuitModel,
  getPlayerZoneGroups,
  getResultsOverlayModel,
  getScoreRows,
  getSharedZones,
  getStatusBarModel,
  getZoneDisplayMode,
  isPublicOnTable,
  nextNewCardStartIndex,
  resolveTableColor,
  revealCards,
  type ActiveSuitModel,
  type PlayerZoneGroup,
  type ResultsOverlayModel,
  type ScoreRow,
  type StatusBarModel,
  type ZoneDisplayMode,
  type ZoneEntry,
} from "./game-table-model";
import { useGameOrchestrator } from "./use-game-orchestrator";

// ─── Screen Model ──────────────────────────────────────────────────

export interface ZoneViewModel {
  readonly name: string;
  readonly zone: ZoneState;
  readonly revealed: boolean;
}

export interface PlayerSectionModel extends PlayerZoneGroup {
  readonly zoneViews: readonly ZoneViewModel[];
}

export type GameTableModel =
  | { readonly kind: "invalid_screen"; readonly message: "Invalid screen state" }
  | { readonly kind: "no_game"; readonly message: "No game in progress" }
  | {
      readonly kind: "table";
      readonly engineState: CardGameState;
      readonly tableColor: string;
      readonly statusBar: StatusBarModel;
      readonly sharedZones: readonly ZoneViewModel[];
      readonly activeSuit: ActiveSuitModel | null;
      /** True when the TABLE section has anything to show. */
      readonly showSharedSection: boolean;
      readonly playerSections: readonly PlayerSectionModel[];
      readonly scoreRows: readonly ScoreRow[];
      readonly overlay: ResultsOverlayModel | null;
      readonly backToMenu: () => void;
    };

function toZoneViews(engineState: CardGameState, zones: readonly ZoneEntry[]): ZoneViewModel[] {
  return zones.map(([name, zone]) => ({
    name,
    zone,
    revealed: isPublicOnTable(engineState, name),
  }));
}

/**
 * Screen-level view model. Runs the orchestrator and derives every
 * section the table renders. Hooks run unconditionally; the guard is
 * expressed through the returned `kind`.
 */
export function useGameTableModel(
  state: HostGameState,
  dispatch: (action: HostAction) => void,
): GameTableModel {
  useGameOrchestrator(state, dispatch);

  const engineState = state.screen.tag === "game_table" ? state.engineState : null;

  const backToMenu = useCallback(() => {
    dispatch({ type: "BACK_TO_PICKER" });
  }, [dispatch]);

  return useMemo((): GameTableModel => {
    if (state.screen.tag !== "game_table") {
      return { kind: "invalid_screen", message: "Invalid screen state" };
    }
    if (engineState === null) {
      return { kind: "no_game", message: "No game in progress" };
    }

    const sharedZones = toZoneViews(engineState, getSharedZones(engineState));
    const activeSuitName = engineState.stringVariables?.active_suit ?? "";
    const activeSuit = activeSuitName !== "" ? getActiveSuitModel(activeSuitName) : null;

    return {
      kind: "table",
      engineState,
      tableColor: resolveTableColor(engineState.ruleset.ui),
      statusBar: getStatusBarModel(engineState),
      sharedZones,
      activeSuit,
      showSharedSection: sharedZones.length > 0 || activeSuit !== null,
      playerSections: getPlayerZoneGroups(engineState).map((group) => ({
        ...group,
        zoneViews: toZoneViews(engineState, group.zones),
      })),
      scoreRows: getScoreRows(engineState),
      overlay: getResultsOverlayModel(engineState),
      backToMenu,
    };
  }, [state.screen.tag, engineState, backToMenu]);
}

// ─── Zone Model ────────────────────────────────────────────────────

export interface ZoneModel {
  /** Cards as shown (forced face-up when revealed). */
  readonly cards: readonly Card[];
  readonly mode: ZoneDisplayMode;
  /** Index from which cards are "newly dealt" (-1 when none). */
  readonly newCardStartIndex: number;
  readonly toggleExpanded: () => void;
}

/**
 * Per-zone state: the expand/collapse toggle and the "newly dealt"
 * marker that drives the deal-in animation. The marker is cleared
 * {@link DEAL_MARK_CLEAR_MS} after the card count last changed.
 */
export function useZoneModel(name: string, zone: ZoneState, revealed: boolean): ZoneModel {
  const [expanded, setExpanded] = useState(false);
  const cards = useMemo(() => revealCards(zone.cards, revealed), [revealed, zone.cards]);

  // Track previous card count to detect newly dealt cards
  const prevCardCountRef = useRef(cards.length);
  const newCardStartIndex = useRef(-1);

  newCardStartIndex.current = nextNewCardStartIndex(
    prevCardCountRef.current,
    cards.length,
    newCardStartIndex.current,
  );
  prevCardCountRef.current = cards.length;

  // Clear the "new" marker once the staggered deal has finished.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cards.length is the deliberate trigger — the effect only reads a ref and must re-arm the timer whenever the card count changes
  useEffect(() => {
    if (newCardStartIndex.current >= 0) {
      const timer = setTimeout(() => {
        newCardStartIndex.current = -1;
      }, DEAL_MARK_CLEAR_MS);
      return () => clearTimeout(timer);
    }
  }, [cards.length]);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  return {
    cards,
    mode: getZoneDisplayMode({ name, cards, revealed, expanded }),
    newCardStartIndex: newCardStartIndex.current,
    toggleExpanded,
  };
}

// ─── Flip Trigger ──────────────────────────────────────────────────

/**
 * Invokes `onFlip` whenever `faceUp` transitions false → true. The
 * animation mechanism (RN `Animated` vs. CSS keyframes) belongs to the
 * caller; an optional cleanup returned by `onFlip` runs like an effect
 * cleanup.
 */
export function useFlipOnReveal(faceUp: boolean, onFlip: () => unknown): void {
  const wasFaceUpRef = useRef(faceUp);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onFlip is intentionally read at flip time only; re-running on every new callback identity would replay the flip
  useEffect(() => {
    const cleanup = faceUp && !wasFaceUpRef.current ? onFlip() : undefined;
    wasFaceUpRef.current = faceUp;
    return typeof cleanup === "function" ? (): void => void cleanup() : undefined;
  }, [faceUp]);
}
