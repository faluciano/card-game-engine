// ─── Game Orchestrator Hook (display) ──────────────────────────────
// Web port of packages/host/src/hooks/useGameOrchestrator.ts. The logic
// is unchanged — it was already pure timers + dispatch. Whoever owns the
// runtime runs this; on a cross-network setup that's the browser display.

import { useEffect, useRef } from "react";
import type { HostAction, HostGameState } from "@card-engine/shared";

const RESULTS_DISPLAY_MS = 5_000;

/** Delay between paced automatic-phase steps (e.g., dealer draws). */
const STEP_INTERVAL_MS = 900;

/** Safety cap on consecutive steps within a single phase to avoid loops. */
const MAX_STEPS_PER_PHASE = 30;

/**
 * Watches engine state transitions and auto-dispatches host actions.
 *
 * Handles:
 * - **Paced automatic phases**: When the game lingers in an `automatic`
 *   phase that defines an `onStep` hook (e.g., a dealer drawing one card
 *   at a time), a `STEP_PHASE` action is dispatched every
 *   {@link STEP_INTERVAL_MS}ms until the phase transitions out.
 * - **Game finished → auto reset**: When a round ends, the results
 *   overlay is shown for {@link RESULTS_DISPLAY_MS}ms, then a
 *   `RESET_ROUND` action is dispatched to start a new round.
 */
export function useGameOrchestrator(
  state: HostGameState,
  dispatch: (action: HostAction) => void,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks how many steps we've dispatched within the current phase entry,
  // so a stuck paced phase can't schedule steps forever.
  const stepPhaseRef = useRef<string | null>(null);
  const stepCountRef = useRef(0);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const { engineState, screen } = state;

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

    // ── Paced Automatic Phase → step one at a time ──────────────
    const phase = engineState.ruleset.phases.find(
      (p) => p.name === engineState.currentPhase,
    );
    const isPaced =
      phase?.kind === "automatic" && (phase.onStep?.length ?? 0) > 0;

    if (isPaced) {
      if (stepPhaseRef.current !== engineState.currentPhase) {
        stepPhaseRef.current = engineState.currentPhase;
        stepCountRef.current = 0;
      }

      if (stepCountRef.current < MAX_STEPS_PER_PHASE) {
        timerRef.current = setTimeout(() => {
          stepCountRef.current += 1;
          dispatch({ type: "STEP_PHASE" });
        }, STEP_INTERVAL_MS);
      }

      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    }

    // Not in a paced phase — forget any prior step bookkeeping.
    stepPhaseRef.current = null;
    stepCountRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.screen.tag,
    state.engineState?.status.kind,
    state.engineState?.currentPhase,
    state.engineState?.version,
    dispatch,
  ]);
}
