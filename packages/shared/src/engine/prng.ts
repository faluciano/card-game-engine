// ─── Seeded PRNG ───────────────────────────────────────────────────
// Deterministic pseudo-random number generation for reproducible
// game replays. All randomness flows through a seed — no Math.random().

// mulberry32 — a fast, high-quality 32-bit seeded PRNG, split into its two
// halves so the state word can be read out and resumed.

/** Advances a mulberry32 state word by one step. */
function advance(state: number): number {
  return ((state | 0) + 0x6d2b79f5) | 0;
}

/** Produces the output float for an already-advanced mulberry32 state word. */
function output(state: number): number {
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A seeded random number generator wrapping mulberry32.
 * Provides utility methods for integers, shuffling, and picking.
 *
 * The full generator state is a single uint32, exposed via {@link state} so
 * it can be stored in serializable game state and resumed later with
 * `createRng(state)` — the resumed generator continues the exact sequence.
 */
export class SeededRng {
  private current: number;

  constructor(seed: number) {
    this.current = seed >>> 0;
  }

  /** The current generator state as a uint32. `createRng(state)` resumes from here. */
  get state(): number {
    return this.current >>> 0;
  }

  private rng(): number {
    this.current = advance(this.current);
    return output(this.current);
  }

  /** Returns the next pseudo-random float in [0, 1). */
  next(): number {
    return this.rng();
  }

  /**
   * Returns a pseudo-random integer in [min, max).
   * @throws {RangeError} if min >= max or either value is not a safe integer.
   */
  nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new RangeError("min and max must be safe integers");
    }
    if (min >= max) {
      throw new RangeError(`min (${min}) must be less than max (${max})`);
    }
    return min + Math.floor(this.rng() * (max - min));
  }

  /**
   * Fisher-Yates shuffle (modern, from end to start).
   * Returns a **new** array — the input is never mutated.
   */
  shuffle<T>(array: readonly T[]): T[] {
    if (array.length === 0) return [];

    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = result[i]!;
      result[i] = result[j]!;
      result[j] = tmp;
    }
    return result;
  }

  /**
   * Pick a random element from the array.
   * @throws {RangeError} if the array is empty.
   */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new RangeError("Cannot pick from an empty array");
    }
    return array[Math.floor(this.rng() * array.length)]!;
  }
}

/** Factory function — creates a new SeededRng from the given seed. */
export function createRng(seed: number): SeededRng {
  return new SeededRng(seed);
}

/**
 * Generates a high-quality 32-bit seed.
 * Uses crypto.getRandomValues when available (Node, browsers),
 * falls back to Date.now() XOR'd with Math.random() for Hermes.
 */
export function generateSeed(): number {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0]!;
  }
  // Fallback for Hermes (Android TV) — XOR to increase entropy
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}
