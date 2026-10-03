// ─── Engine Cache ──────────────────────────────────────────────────
// One engine per ruleset, shared by the host reducer and the client-view
// projection. Safe to share across games: the engine holds no per-game
// state (the PRNG state lives in CardGameState). Keyed weakly so a
// dropped ruleset can be garbage-collected.

import type { CardGameRuleset } from "../types/index";
import { createEngine, type GameEngine } from "../engine/interpreter";
import type { PhaseMachine } from "../engine/phase-machine";

const engineCache = new WeakMap<CardGameRuleset, GameEngine>();

/** Returns the cached engine for `ruleset`, creating it on first use. */
export function getEngine(ruleset: CardGameRuleset): GameEngine {
  const cached = engineCache.get(ruleset);
  if (cached) return cached;

  const engine = createEngine(ruleset);
  engineCache.set(ruleset, engine);
  return engine;
}

/** The cached phase machine for `ruleset` — pass it to the action validators. */
export function getPhaseMachine(ruleset: CardGameRuleset): PhaseMachine {
  return getEngine(ruleset).phaseMachine;
}
