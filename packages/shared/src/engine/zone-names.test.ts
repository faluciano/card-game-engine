import { describe, it, expect } from "vitest";
import { perPlayerZone, zoneOwnerIndex } from "./zone-names";

// ─── Tests ─────────────────────────────────────────────────────────

describe("perPlayerZone", () => {
  it("joins the base name and player index with a colon", () => {
    expect(perPlayerZone("hand", 2)).toBe("hand:2");
  });

  it("handles player index 0", () => {
    expect(perPlayerZone("won", 0)).toBe("won:0");
  });
});

describe("zoneOwnerIndex", () => {
  it("returns the player index of a per-player zone", () => {
    expect(zoneOwnerIndex("hand:2")).toBe(2);
    expect(zoneOwnerIndex("trick:0")).toBe(0);
  });

  it("returns null for a shared zone", () => {
    expect(zoneOwnerIndex("discard")).toBeNull();
  });

  it("returns null when the suffix is not a number", () => {
    expect(zoneOwnerIndex("hand:")).toBeNull();
    expect(zoneOwnerIndex("hand:x")).toBeNull();
  });
});
