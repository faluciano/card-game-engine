// ─── Game Orchestrator Hook ────────────────────────────────────────
// Watches the card engine state and auto-dispatches host-only actions
// to advance the game through automatic lifecycle transitions.
// Runs on the TV host only.

import { useEffect, useRef } from "react";
import type { HostAction, HostGameState } from "../types/host-state.js";

const RESULTS_DISPLAY_MS = 5_000;

/**
 * Watches engine state transitions and auto-dispatches host actions.
 *
 * Currently handles:
 * - **Game finished → auto reset**: When a round ends, the results
 *   overlay is shown for {@link RESULTS_DISPLAY_MS}ms, then a
 *   `RESET_ROUND` action is dispatched to start a new round.
 */
export function useGameOrchestrator(
  state: HostGameState,
  dispatch: (action: HostAction) => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer on state change
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const { engineState, screen } = state;

    // Only orchestrate when on the game table with active engine state
    if (screen.tag !== "game_table") return;
    if (engineState === null) return;

    // ── Game Finished → Show results, then reset ────────────────
    if (engineState.status.kind === "finished") {
      timerRef.current = setTimeout(() => {
        dispatch({ type: "RESET_ROUND" });
      }, RESULTS_DISPLAY_MS);

      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [
    state.screen.tag,
    state.engineState?.status.kind,
    state.engineState?.currentPhase,
    state.engineState?.version,
    dispatch,
  ]);
}
