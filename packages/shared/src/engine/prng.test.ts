import { describe, it, expect } from "vitest";
import { SeededRng, createRng } from "./prng.js";

// ─── Tests ─────────────────────────────────────────────────────────

describe("prng", () => {
  // ══════════════════════════════════════════════════════════════════
  // ── createRng factory ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("createRng", () => {
    it("returns an instance of SeededRng", () => {
      const rng = createRng(42);
      expect(rng).toBeInstanceOf(SeededRng);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── Determinism ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("determinism", () => {
    it("produces the same sequence for the same seed", () => {
      const rng1 = createRng(12345);
      const rng2 = createRng(12345);

      const seq1 = Array.from({ length: 100 }, () => rng1.next());
      const seq2 = Array.from({ length: 100 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it("produces different sequences for different seeds", () => {
      const rng1 = createRng(1);
      const rng2 = createRng(2);

      const seq1 = Array.from({ length: 20 }, () => rng1.next());
      const seq2 = Array.from({ length: 20 }, () => rng2.next());

      expect(seq1).not.toEqual(seq2);
    });

    it("is deterministic across many calls", () => {
      const rng1 = createRng(999);
      const rng2 = createRng(999);

      // Skip ahead 500 values
      for (let i = 0; i < 500; i++) {
        rng1.next();
        rng2.next();
      }

      // The 501st value should still match
      expect(rng1.next()).toBe(rng2.next());
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── next() ───────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("next", () => {
    it("returns values in [0, 1)", () => {
      const rng = createRng(42);
      for (let i = 0; i < 10_000; i++) {
        const val = rng.next();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it("produces varied output (not constant)", () => {
      const rng = createRng(42);
      const values = new Set<number>();
      for (let i = 0; i < 100; i++) {
        values.add(rng.next());
      }
      // A good PRNG should produce many unique values
      expect(values.size).toBeGreaterThan(90);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── nextInt(min, max) ────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("nextInt", () => {
    it("returns integers in [min, max)", () => {
      const rng = createRng(42);
      for (let i = 0; i < 10_000; i++) {
        const val = rng.nextInt(0, 10);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(10);
      }
    });

    it("respects non-zero min", () => {
      const rng = createRng(42);
      for (let i = 0; i < 5_000; i++) {
        const val = rng.nextInt(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThan(10);
      }
    });

    it("handles negative range", () => {
      const rng = createRng(42);
      for (let i = 0; i < 5_000; i++) {
        const val = rng.nextInt(-10, -5);
        expect(val).toBeGreaterThanOrEqual(-10);
        expect(val).toBeLessThan(-5);
      }
    });

    it("handles range of size 1 (returns the only value)", () => {
      const rng = createRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextInt(7, 8)).toBe(7);
      }
    });

    it("is deterministic", () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);

      const seq1 = Array.from({ length: 50 }, () => rng1.nextInt(0, 100));
      const seq2 = Array.from({ length: 50 }, () => rng2.nextInt(0, 100));

      expect(seq1).toEqual(seq2);
    });

    describe("guard: min >= max throws RangeError", () => {
      it("throws when min equals max", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(5, 5)).toThrow(RangeError);
        expect(() => rng.nextInt(5, 5)).toThrow("must be less than max");
      });

      it("throws when min is greater than max", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(10, 5)).toThrow(RangeError);
        expect(() => rng.nextInt(10, 5)).toThrow("must be less than max");
      });
    });

    describe("guard: non-integer bounds throw RangeError", () => {
      it("throws when min is not a safe integer", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(1.5, 10)).toThrow(RangeError);
        expect(() => rng.nextInt(1.5, 10)).toThrow("safe integers");
      });

      it("throws when max is not a safe integer", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(0, 10.5)).toThrow(RangeError);
        expect(() => rng.nextInt(0, 10.5)).toThrow("safe integers");
      });

      it("throws on NaN", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(NaN, 10)).toThrow(RangeError);
      });

      it("throws on Infinity", () => {
        const rng = createRng(42);
        expect(() => rng.nextInt(0, Infinity)).toThrow(RangeError);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── shuffle ──────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("shuffle", () => {
    it("returns a new array (not the same reference)", () => {
      const rng = createRng(42);
      const original = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(original);
      expect(shuffled).not.toBe(original);
    });

    it("returns an array with the same length", () => {
      const rng = createRng(42);
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle(original);
      expect(shuffled).toHaveLength(original.length);
    });

    it("returns an array containing all original elements", () => {
      const rng = createRng(42);
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle(original);
      expect(shuffled.sort((a, b) => a - b)).toEqual(original.sort((a, b) => a - b));
    });

    it("does not mutate the original array", () => {
      const rng = createRng(42);
      const original = [1, 2, 3, 4, 5];
      const copy = [...original];
      rng.shuffle(original);
      expect(original).toEqual(copy);
    });

    it("is deterministic (same seed → same shuffle)", () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);
      const arr = ["A", "B", "C", "D", "E", "F", "G", "H"];

      const shuffled1 = rng1.shuffle(arr);
      const shuffled2 = rng2.shuffle(arr);

      expect(shuffled1).toEqual(shuffled2);
    });

    it("actually shuffles (produces a different order for non-trivial arrays)", () => {
      const rng = createRng(42);
      const original = Array.from({ length: 52 }, (_, i) => i);
      const shuffled = rng.shuffle(original);

      // It's astronomically unlikely (1/52!) that a shuffle of 52 items is the same
      expect(shuffled).not.toEqual(original);
    });

    it("returns an empty array for empty input", () => {
      const rng = createRng(42);
      const result = rng.shuffle([]);
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it("returns a single-element array for single-element input", () => {
      const rng = createRng(42);
      const result = rng.shuffle([99]);
      expect(result).toEqual([99]);
      expect(result).toHaveLength(1);
    });

    it("handles readonly arrays", () => {
      const rng = createRng(42);
      const original: readonly string[] = Object.freeze(["x", "y", "z"]);
      const shuffled = rng.shuffle(original);
      expect(shuffled).toHaveLength(3);
      expect(shuffled.sort()).toEqual(["x", "y", "z"]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // ── pick ─────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  describe("pick", () => {
    it("returns an element from the array", () => {
      const rng = createRng(42);
      const arr = ["apple", "banana", "cherry"];
      const picked = rng.pick(arr);
      expect(arr).toContain(picked);
    });

    it("is deterministic", () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);
      const arr = [10, 20, 30, 40, 50];

      expect(rng1.pick(arr)).toBe(rng2.pick(arr));
    });

    it("picks from single-element array", () => {
      const rng = createRng(42);
      expect(rng.pick([42])).toBe(42);
    });

    it("picks varied elements over many calls", () => {
      const rng = createRng(42);
      const arr = [1, 2, 3, 4, 5];
      const picked = new Set<number>();
      for (let i = 0; i < 200; i++) {
        picked.add(rng.pick(arr));
      }
      // Over 200 picks from 5 elements, we should hit all of them
      expect(picked.size).toBe(5);
    });

    it("throws RangeError on empty array", () => {
      const rng = createRng(42);
      expect(() => rng.pick([])).toThrow(RangeError);
      expect(() => rng.pick([])).toThrow("Cannot pick from an empty array");
    });
  });
});
