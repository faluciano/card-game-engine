// ─── Phase Machine ─────────────────────────────────────────────────
// A finite state machine that manages game phase transitions.
// Each phase has a kind (automatic | turn_based | all_players),
// allowed actions, and conditional transitions to other phases.

import type {
  CardGameState,
  PhaseDefinition,
  PhaseTransition,
} from "../types/index.js";

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

  constructor(phases: readonly PhaseDefinition[]) {
    const map = new Map<string, PhaseDefinition>();
    for (const phase of phases) {
      if (map.has(phase.name)) {
        throw new Error(`Duplicate phase name: "${phase.name}"`);
      }
      map.set(phase.name, phase);
    }
    this.phasesByName = map;
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
   */
  evaluateTransitions(state: CardGameState): TransitionResult {
    const phase = this.getPhase(state.currentPhase);

    // TODO: Evaluate each transition's `when` expression against state
    // TODO: Return first matching transition
    // For now, stay in current phase
    return { kind: "stay" };
  }

  /** Returns all phase names in definition order. */
  get phaseNames(): readonly string[] {
    return Array.from(this.phasesByName.keys());
  }
}
