// ─── Ruleset Playthrough ───────────────────────────────────────────
// Plays every shipped ruleset in rulesets/ with seeded random legal
// moves, the way a table of players would: whoever may act picks one
// of their enabled actions (a playable card, or a declaration with
// valid params) and the host steps paced automatic phases. After every
// move the game must still hold the whole deck, keep cards in hidden
// and owner-only zones face-down (the TV shows face-up cards), and give
// every player a view that hides the other players' hands.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
  GameSessionId,
  Player,
  PlayerId,
} from "../types/index";
import { createEngine, createInitialState, type GameEngine } from "./interpreter";
import { getPlayableCardIndices, getValidActions } from "./action-validator";
import { createPlayerView } from "./state-filter";
import { createRng, type SeededRng } from "./prng";
import { loadRuleset } from "../schema/index";

// ─── Fixtures ──────────────────────────────────────────────────────

const RULESETS_DIR = resolve(import.meta.dirname ?? __dirname, "../../../../rulesets");

/** Moves per game. Enough for several rounds of every shipped game. */
const MAX_MOVES = 300;

const SEEDS = [1, 2, 3] as const;

function loadShippedRulesets(): readonly CardGameRuleset[] {
  return readdirSync(RULESETS_DIR)
    .filter((file) => file.endsWith(".cardgame.json"))
    .sort()
    .map((file) => loadRuleset(JSON.parse(readFileSync(resolve(RULESETS_DIR, file), "utf-8"))));
}

function makePlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}` as PlayerId,
    name: `Player ${i}`,
    role: "player",
    connected: true,
  }));
}

/** The smallest and largest table the ruleset allows. */
function playerCounts(ruleset: CardGameRuleset): readonly number[] {
  const { min, max } = ruleset.meta.players;
  return min === max ? [min] : [min, max];
}

// ─── Move Generation ───────────────────────────────────────────────

/** Every concrete move a player could make right now. */
function legalMoves(
  engine: GameEngine,
  state: CardGameState,
  playerIndex: number,
  rng: SeededRng,
): CardGameAction[] {
  const player = state.players[playerIndex]!;
  const hand = state.zones[`hand:${playerIndex}`]?.cards ?? [];
  const moves: CardGameAction[] = [];

  for (const action of getValidActions(state, player.id, engine.phaseMachine)) {
    if (!action.enabled) continue;

    if (action.actionName === "play_card") {
      const indices = getPlayableCardIndices(
        state,
        engine.ruleset,
        playerIndex,
        engine.phaseMachine,
      );
      for (const i of indices) {
        moves.push({
          kind: "play_card",
          playerId: player.id,
          cardId: hand[i]!.id,
          fromZone: `hand:${playerIndex}`,
          toZone: action.targetZone ?? "discard",
        });
      }
      continue;
    }

    const params: Record<string, string | number> = {};
    for (const [name, spec] of Object.entries(action.params ?? {})) {
      if (spec.kind === "other_player") {
        const others = state.players.map((_, i) => i).filter((i) => i !== playerIndex);
        params[name] = others[rng.nextInt(0, others.length)]!;
      } else {
        if (hand.length === 0) continue;
        params[name] = hand[rng.nextInt(0, hand.length)]!.rank;
      }
    }
    moves.push({ kind: "declare", playerId: player.id, declaration: action.actionName, params });
  }

  return moves;
}

/** Players who may act: everyone in an `all_players` phase, else the current player. */
function actingPlayers(engine: GameEngine, state: CardGameState): readonly number[] {
  const phase = engine.phaseMachine.findPhase(state.currentPhase);
  return phase?.kind === "all_players"
    ? state.players.map((_, i) => i)
    : [state.currentPlayerIndex];
}

// ─── Invariants ────────────────────────────────────────────────────

function effectiveVisibilityKind(state: CardGameState, zoneName: string): string {
  const zone = state.zones[zoneName]!;
  const override = zone.definition.phaseOverrides?.find((o) => o.phase === state.currentPhase);
  return (override?.visibility ?? zone.definition.visibility).kind;
}

function checkInvariants(state: CardGameState, deckSize: number, where: string): void {
  const all = Object.values(state.zones).flatMap((zone) => zone.cards);
  expect(all, `${where}: card count`).toHaveLength(deckSize);
  expect(new Set(all.map((c) => c.id)).size, `${where}: duplicate card ids`).toBe(deckSize);

  for (const [name, zone] of Object.entries(state.zones)) {
    const kind = effectiveVisibilityKind(state, name);
    if (kind !== "hidden" && kind !== "owner_only") continue;
    const faceUp = zone.cards.filter((c) => c.faceUp).map((c) => `${c.rank} of ${c.suit}`);
    expect(faceUp, `${where}: face-up cards in ${kind} zone ${name}`).toEqual([]);
  }

  state.players.forEach((player, viewer) => {
    const view = createPlayerView(state, player.id);
    for (const [name, zone] of Object.entries(view.zones)) {
      const owner = name.match(/:(\d+)$/);
      if (!owner || Number(owner[1]) === viewer) continue;
      if (effectiveVisibilityKind(state, name) !== "owner_only") continue;
      expect(
        zone.cards.every((c) => c === null),
        `${where}: player ${viewer} sees ${name}`,
      ).toBe(true);
    }
  });
}

// ─── Playthrough ───────────────────────────────────────────────────

interface PlaythroughResult {
  readonly moves: number;
  readonly gamesFinished: number;
}

function playthrough(
  ruleset: CardGameRuleset,
  playerCount: number,
  seed: number,
): PlaythroughResult {
  const engine = createEngine(ruleset, { now: () => 0 });
  const rng = createRng(seed);
  const initial = createInitialState(
    ruleset,
    "playthrough" as GameSessionId,
    makePlayers(playerCount),
    seed,
  );
  const deckSize = Object.values(initial.zones).reduce((n, zone) => n + zone.cards.length, 0);

  const apply = (state: CardGameState, action: CardGameAction, where: string): CardGameState => {
    const result = engine.apply(state, action);
    if (result.kind === "rejected") {
      throw new Error(`${where}: ${JSON.stringify(action)} rejected: ${result.reason}`);
    }
    checkInvariants(result.state, deckSize, where);
    return result.state;
  };

  let state = apply(initial, { kind: "start_game" }, "start");
  let gamesFinished = 0;
  let moves = 0;

  for (; moves < MAX_MOVES; moves++) {
    const where = `move ${moves} (phase ${state.currentPhase})`;

    // The host's orchestrator: restart a finished game, step paced phases.
    if (state.status.kind === "finished") {
      gamesFinished++;
      state = apply(state, { kind: "reset_round" }, where);
      continue;
    }
    const phase = engine.phaseMachine.findPhase(state.currentPhase);
    if (phase?.kind === "automatic" && (phase.onStep?.length ?? 0) > 0) {
      state = apply(state, { kind: "step_phase" }, where);
      continue;
    }

    const options = actingPlayers(engine, state).flatMap((i) => legalMoves(engine, state, i, rng));
    if (options.length === 0) {
      throw new Error(`${where}: no player has a legal move`);
    }
    state = apply(state, options[rng.nextInt(0, options.length)]!, where);
  }

  return { moves, gamesFinished };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("shipped ruleset playthroughs", () => {
  const rulesets = loadShippedRulesets();

  it("finds the shipped rulesets", () => {
    expect(rulesets.length).toBeGreaterThanOrEqual(5);
  });

  for (const ruleset of rulesets) {
    for (const playerCount of playerCounts(ruleset)) {
      for (const seed of SEEDS) {
        it(`plays ${ruleset.meta.name} with ${playerCount} players (seed ${seed}) without breaking the table`, () => {
          const result = playthrough(ruleset, playerCount, seed);
          expect(result.moves).toBe(MAX_MOVES);
        });
      }
    }
  }
});
