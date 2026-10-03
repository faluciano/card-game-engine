import { describe, it, expect } from "vitest";
import { BUILT_IN_SLUGS as BUNDLED_SLUGS } from "../built-in-rulesets";
import { BUILT_IN_SLUGS, isBuiltInSlug } from "./built-in-slugs";

describe("BUILT_IN_SLUGS (catalog subpath)", () => {
  it("matches the slugs derived from the bundled rulesets", () => {
    expect([...BUILT_IN_SLUGS].sort()).toEqual([...BUNDLED_SLUGS].sort());
  });

  it("recognises built-in slugs", () => {
    expect(isBuiltInSlug("crazy-eights")).toBe(true);
    expect(isBuiltInSlug("blackjack")).toBe(false);
    expect(isBuiltInSlug("")).toBe(false);
  });
});
