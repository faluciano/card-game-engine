// ─── Phase Machine ─────────────────────────────────────────────────
// A finite state machine that manages game phase transitions.
// Each phase has a kind (automatic | turn_based | all_players),
// allowed actions, and conditional transitions to other phases.

import type {
  CardGameState,
  PhaseAction,
  PhaseDefinition,
  PhaseTransition,
} from "../types/index";
import {
  evaluateCondition,
  ExpressionError,
  type EvalContext,
} from "./expression-evaluator";

/** The result of evaluating a phase transition. */
export type TransitionResult =
  | { readonly kind: "stay" }
  | { readonly kind: "advance"; readonly nextPhase: string };

/**
 * Manages phase transitions for a game.
 * Constructed from the ruleset's phase definitions.
 */
export class PhaseMachine {
  private readonly phasesByName: ReadonlyMap<string, PhaseDefinition>;
  private readonly globalTransitions: readonly PhaseTransition[];

  constructor(
    phases: readonly PhaseDefinition[],
    globalTransitions: readonly PhaseTransition[] = []
  ) {
    const map = new Map<string, PhaseDefinition>();
    for (const phase of phases) {
      if (map.has(phase.name)) {
        throw new Error(`Duplicate phase name: "${phase.name}"`);
      }
      map.set(phase.name, phase);
    }
    this.phasesByName = map;
    this.globalTransitions = globalTransitions;
  }

  /** Returns the phase definition for the given name, or throws. */
  getPhase(name: string): PhaseDefinition {
    const phase = this.phasesByName.get(name);
    if (!phase) {
      throw new Error(`Unknown phase: "${name}"`);
    }
    return phase;
  }

  /**
   * Evaluates all transitions for the current phase against game state.
   * Returns the first matching transition, or "stay" if none match.
   *
   * Transitions are evaluated in declaration order — the first `when`
   * condition that evaluates to `true` wins.
   */
  evaluateTransitions(state: CardGameState): TransitionResult {
    const phase = this.getPhase(state.currentPhase);
    const context: EvalContext = { state };

    // 1. Evaluate phase-specific transitions first
    for (const transition of phase.transitions) {
      // Validate that the target phase exists before evaluating the condition.
      // Fail fast: a misconfigured ruleset should be caught immediately.
      if (!this.phasesByName.has(transition.to)) {
        throw new Error(
          `Phase "${state.currentPhase}" has a transition to unknown phase: "${transition.to}"`
        );
      }

      try {
        const conditionMet = evaluateCondition(transition.when, context);
        if (conditionMet) {
          return { kind: "advance", nextPhase: transition.to };
        }
      } catch (error) {
        // ExpressionErrors from unresolvable conditions mean the condition
        // isn't met — log a warning and continue to the next transition.
        if (error instanceof ExpressionError) {
          console.warn(
            `Phase "${state.currentPhase}": transition condition "${transition.when}" ` +
              `failed to evaluate: ${error.message}. Treating as not met.`
          );
          continue;
        }
        // Re-throw non-expression errors (programming bugs, etc.)
        throw error;
      }
    }

    // 2. Evaluate global transitions (fallback after phase-specific ones)
    for (const transition of this.globalTransitions) {
      if (!this.phasesByName.has(transition.to)) {
        throw new Error(
          `Global transition targets unknown phase: "${transition.to}"`
        );
      }

      try {
        const conditionMet = evaluateCondition(transition.when, context);
        if (conditionMet) {
          return { kind: "advance", nextPhase: transition.to };
        }
      } catch (error) {
        if (error instanceof ExpressionError) {
          console.warn(
            `Global transition condition "${transition.when}" ` +
              `failed to evaluate: ${error.message}. Treating as not met.`
          );
          continue;
        }
        throw error;
      }
    }

    return { kind: "stay" };
  }

  /**
   * Returns the allowed actions for the given phase.
   * Used by the action validator to check if an action is legal.
   */
  getValidActionsForPhase(phaseName: string): readonly PhaseAction[] {
    const phase = this.getPhase(phaseName);
    return phase.actions;
  }

  /**
   * Returns whether the named phase has kind "automatic".
   * Used by the interpreter to decide whether to immediately execute the phase.
   */
  isAutomaticPhase(phaseName: string): boolean {
    const phase = this.getPhase(phaseName);
    return phase.kind === "automatic";
  }

  /** Returns all phase names in definition order. */
  get phaseNames(): readonly string[] {
    return Array.from(this.phasesByName.keys());
  }
}
