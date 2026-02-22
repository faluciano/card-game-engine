// ─── Seeded PRNG ───────────────────────────────────────────────────
// Deterministic pseudo-random number generation for reproducible
// game replays. All randomness flows through a seed — no Math.random().

/**
 * mulberry32 — a fast, high-quality 32-bit seeded PRNG.
 * Returns a function that produces the next pseudo-random float in [0, 1).
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded random number generator wrapping mulberry32.
 * Provides utility methods for integers, shuffling, and picking.
 */
export class SeededRng {
  private readonly rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
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
