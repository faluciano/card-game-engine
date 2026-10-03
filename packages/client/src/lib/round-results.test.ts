import { describe, it, expect } from "vitest";
import { formatScore, getResultConfig } from "./round-results.js";

describe("getResultConfig", () => {
  it("reports a win for a positive result", () => {
    expect(getResultConfig(1).label).toBe("You Win!");
    expect(getResultConfig(50).label).toBe("You Win!");
  });

  it("reports a loss for a negative result", () => {
    expect(getResultConfig(-1).label).toBe("You Lose");
  });

  it("reports a draw for zero", () => {
    expect(getResultConfig(0).label).toBe("Draw");
  });

  it("uses a distinct color per outcome", () => {
    const colors = new Set([-1, 0, 1].map((r) => getResultConfig(r).color));
    expect(colors.size).toBe(3);
  });
});

describe("formatScore", () => {
  it("joins label and score", () => {
    expect(formatScore("Dealer", 19)).toBe("Dealer: 19");
  });
});
