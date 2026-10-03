import { describe, it, expect } from "vitest";
import { perPlayerZone } from "./zone-names";

// ─── Tests ─────────────────────────────────────────────────────────

describe("perPlayerZone", () => {
  it("joins the base name and player index with a colon", () => {
    expect(perPlayerZone("hand", 2)).toBe("hand:2");
  });

  it("handles player index 0", () => {
    expect(perPlayerZone("won", 0)).toBe("won:0");
  });
});
