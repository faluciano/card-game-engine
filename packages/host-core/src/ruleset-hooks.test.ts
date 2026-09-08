import { describe, it, expect } from "vitest";
import type { CardGameRuleset } from "@card-engine/shared";
import { mergeSlugs } from "./ruleset-hooks";
import type { StoredRuleset } from "./ruleset-store";

function stored(slug: string, version: string): StoredRuleset {
  // Only meta.slug / meta.version are read by mergeSlugs.
  const ruleset = { meta: { slug, version } } as unknown as CardGameRuleset;
  return { id: `id-${slug}`, ruleset, importedAt: 0, lastPlayedAt: null };
}

describe("mergeSlugs", () => {
  it("returns built-ins when nothing is stored", () => {
    const builtIn = [{ slug: "crazy-eights", version: "1.0.0" }];
    expect(mergeSlugs(builtIn, [])).toEqual(builtIn);
  });

  it("appends stored slugs after built-ins", () => {
    const builtIn = [{ slug: "crazy-eights", version: "1.0.0" }];
    const result = mergeSlugs(builtIn, [stored("war", "0.2.0")]);
    expect(result).toEqual([
      { slug: "crazy-eights", version: "1.0.0" },
      { slug: "war", version: "0.2.0" },
    ]);
  });

  it("lets a built-in shadow a stored ruleset with the same slug", () => {
    const builtIn = [{ slug: "crazy-eights", version: "1.0.0" }];
    const result = mergeSlugs(builtIn, [stored("crazy-eights", "9.9.9"), stored("war", "0.2.0")]);
    expect(result).toEqual([
      { slug: "crazy-eights", version: "1.0.0" },
      { slug: "war", version: "0.2.0" },
    ]);
  });

  it("returns stored slugs alone when there are no built-ins", () => {
    expect(mergeSlugs([], [stored("war", "0.2.0")])).toEqual([{ slug: "war", version: "0.2.0" }]);
  });
});
