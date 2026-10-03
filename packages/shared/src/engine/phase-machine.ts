// ─── Phase Machine ─────────────────────────────────────────────────
// A finite state machine that manages game phase transitions.
// Each phase has a kind (automatic | turn_based | all_players),
// allowed actions, and conditional transitions to other phases.

import type { CardGameState, PhaseAction, PhaseDefinition, PhaseTransition } from "../types/index";
import { evaluateCondition, type EvalContext } from "./expression-evaluator";

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
    globalTransitions: readonly PhaseTransition[] = [],
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

  /** Returns the phase definition for the given name, or undefined if none exists. */
  findPhase(name: string): PhaseDefinition | undefined {
    return this.phasesByName.get(name);
  }

  /** Returns the phase definition for the given name, or throws. */
  getPhase(name: string): PhaseDefinition {
    const phase = this.findPhase(name);
    if (!phase) {
      throw new Error(`Unknown phase: "${name}"`);
    }
    return phase;
  }

  /**
   * Evaluates all transitions for the current phase against game state.
   * Returns the first matching transition, or "stay" if none match.
   *
   * Transitions are evaluated in declaration order — phase-specific ones
   * first, then global ones — and the first `when` condition that evaluates
   * to `true` wins.
   *
   * Conditions are parse-checked when the ruleset is loaded, so an
   * `ExpressionError` here is a genuine runtime failure (unknown zone,
   * type mismatch, ...) and propagates to the caller instead of being
   * downgraded to "not met".
   *
   * @throws {Error} if a transition targets an undeclared phase.
   * @throws {ExpressionError} if a `when` condition fails to evaluate.
   */
  evaluateTransitions(state: CardGameState): TransitionResult {
    const phase = this.getPhase(state.currentPhase);
    const context: EvalContext = { state };

    const phaseResult = this.firstMatchingTransition(
      phase.transitions,
      context,
      (to) => `Phase "${state.currentPhase}" has a transition to unknown phase: "${to}"`,
    );
    if (phaseResult) return phaseResult;

    const globalResult = this.firstMatchingTransition(
      this.globalTransitions,
      context,
      (to) => `Global transition targets unknown phase: "${to}"`,
    );
    if (globalResult) return globalResult;

    return { kind: "stay" };
  }

  /**
   * Walks `transitions` in order and returns an "advance" result for the
   * first one whose condition holds, or undefined if none do.
   * Validates each target phase before evaluating its condition — a
   * misconfigured ruleset should be caught immediately.
   */
  private firstMatchingTransition(
    transitions: readonly PhaseTransition[],
    context: EvalContext,
    unknownTargetMessage: (to: string) => string,
  ): TransitionResult | undefined {
    for (const transition of transitions) {
      if (!this.phasesByName.has(transition.to)) {
        throw new Error(unknownTargetMessage(transition.to));
      }
      if (evaluateCondition(transition.when, context)) {
        return { kind: "advance", nextPhase: transition.to };
      }
    }
    return undefined;
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
