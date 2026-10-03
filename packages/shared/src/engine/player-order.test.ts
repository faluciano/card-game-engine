import { describe, it, expect } from "vitest";
import { nextPlayerIndex } from "./player-order";

// ─── nextPlayerIndex ───────────────────────────────────────────────

describe("nextPlayerIndex", () => {
  it("advances clockwise by one seat", () => {
    expect(nextPlayerIndex(0, 1, 3)).toBe(1);
  });

  it("wraps clockwise past the last seat", () => {
    expect(nextPlayerIndex(2, 1, 3)).toBe(0);
  });

  it("wraps counterclockwise past the first seat", () => {
    expect(nextPlayerIndex(0, -1, 3)).toBe(2);
  });

  it("moves several seats at once", () => {
    expect(nextPlayerIndex(1, 1, 4, 2)).toBe(3);
    expect(nextPlayerIndex(1, -1, 4, 3)).toBe(2);
  });

  it("stays on the only seat at a one-player table", () => {
    expect(nextPlayerIndex(0, 1, 1)).toBe(0);
    expect(nextPlayerIndex(0, -1, 1)).toBe(0);
  });
});
