// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";
import {
  describeError,
  mergeSlugs,
  useInstalledSlugs,
  useRulesetInstaller,
  useRulesetUninstaller,
} from "./ruleset-hooks";
import type { StoredRuleset } from "./ruleset-store";
import { BUILT_IN_RULESETS } from "./built-in-rulesets";
import { MemoryRulesetStore } from "./memory-ruleset-store";

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

// ─── Hook fixtures ─────────────────────────────────────────────────

const BUILT_IN = [{ slug: "crazy-eights", version: "1.0.0" }] as const;
const VALID: CardGameRuleset = {
  ...BUILT_IN_RULESETS[0]!,
  meta: { ...BUILT_IN_RULESETS[0]!.meta, slug: "war" },
};
const INVALID = { meta: { slug: "broken" } } as unknown as CardGameRuleset;

type PendingInstall = HostGameState["pendingInstall"];

/** Every SET_INSTALLED_SLUGS dispatched, as slug lists. */
function slugDispatches(dispatch: ReturnType<typeof vi.fn>): string[][] {
  return dispatch.mock.calls
    .map(([a]) => a as HostAction)
    .filter((a) => a.type === "SET_INSTALLED_SLUGS")
    .map((a) => (a.type === "SET_INSTALLED_SLUGS" ? a.slugs.map((s) => s.slug) : []));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── describeError ─────────────────────────────────────────────────

describe("describeError", () => {
  it("uses an Error's message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError(42)).toBe("42");
  });
});

// ─── useInstalledSlugs ─────────────────────────────────────────────

describe("useInstalledSlugs", () => {
  it("dispatches built-ins merged with stored slugs", async () => {
    const store = new MemoryRulesetStore();
    await store.save(VALID);
    const dispatch = vi.fn();

    const { result } = renderHook(() => useInstalledSlugs(store, dispatch, BUILT_IN));

    await waitFor(() => expect(slugDispatches(dispatch)).toEqual([["crazy-eights", "war"]]));
    expect(result.current.error).toBeNull();
  });

  it("falls back to built-ins and reports error when the store cannot be read", async () => {
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "list").mockRejectedValue(new Error("index is corrupt"));
    const dispatch = vi.fn();

    const { result } = renderHook(() => useInstalledSlugs(store, dispatch, BUILT_IN));

    await waitFor(() => expect(result.current.error).toBe("index is corrupt"));
    expect(slugDispatches(dispatch)).toEqual([["crazy-eights"]]);
  });

  it("does not dispatch after unmount", async () => {
    const store = new MemoryRulesetStore();
    let resolveList: (v: readonly StoredRuleset[]) => void = () => {};
    vi.spyOn(store, "list").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const dispatch = vi.fn();

    const { unmount } = renderHook(() => useInstalledSlugs(store, dispatch, BUILT_IN));
    unmount();
    resolveList([]);
    await Promise.resolve();

    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─── useRulesetInstaller ───────────────────────────────────────────

describe("useRulesetInstaller", () => {
  it("saves a valid ruleset and dispatches the refreshed slugs", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();
    const pending: PendingInstall = { ruleset: VALID, slug: "war" };

    const { result } = renderHook(() => useRulesetInstaller(store, pending, dispatch, BUILT_IN));

    await waitFor(() => expect(slugDispatches(dispatch)).toEqual([["crazy-eights", "war"]]));
    expect(await store.getBySlug("war")).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("replaces an existing entry with the same slug", async () => {
    const store = new MemoryRulesetStore();
    const old = await store.save(VALID);
    const dispatch = vi.fn();
    const pending: PendingInstall = { ruleset: VALID, slug: "war" };

    renderHook(() => useRulesetInstaller(store, pending, dispatch, BUILT_IN));

    await waitFor(() => expect(slugDispatches(dispatch)).toHaveLength(1));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).not.toBe(old.id);
  });

  it("clears pendingInstall and reports why when the ruleset fails validation", async () => {
    const store = new MemoryRulesetStore();
    const saveSpy = vi.spyOn(store, "saveWithSlug");
    const dispatch = vi.fn();
    const pending: PendingInstall = { ruleset: INVALID, slug: "broken" };

    const { result } = renderHook(() => useRulesetInstaller(store, pending, dispatch, BUILT_IN));

    // The SET_INSTALLED_SLUGS dispatch is what clears pendingInstall in the reducer;
    // before the fix this never fired and phones showed "Installing…" forever.
    await waitFor(() => expect(slugDispatches(dispatch)).toEqual([["crazy-eights"]]));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('Ruleset "broken" was rejected');
    expect(result.current.error).toContain("Validation failed");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("clears pendingInstall and reports the cause when the save throws", async () => {
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "saveWithSlug").mockRejectedValue(new Error("storage is full"));
    const dispatch = vi.fn();
    const pending: PendingInstall = { ruleset: VALID, slug: "war" };

    const { result } = renderHook(() => useRulesetInstaller(store, pending, dispatch, BUILT_IN));

    await waitFor(() =>
      expect(result.current.error).toBe('Could not install "war": storage is full'),
    );
    expect(slugDispatches(dispatch)).toEqual([["crazy-eights"]]);
  });

  it("still clears pendingInstall with built-ins when the store cannot even be listed", async () => {
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "getBySlug").mockRejectedValue(new Error("index is corrupt"));
    vi.spyOn(store, "list").mockRejectedValue(new Error("index is corrupt"));
    const dispatch = vi.fn();
    const pending: PendingInstall = { ruleset: VALID, slug: "war" };

    const { result } = renderHook(() => useRulesetInstaller(store, pending, dispatch, BUILT_IN));

    await waitFor(() => expect(slugDispatches(dispatch)).toEqual([["crazy-eights"]]));
    expect(result.current.error).toContain("index is corrupt");
  });

  it("does nothing when there is no pending install", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();

    const { result } = renderHook(() => useRulesetInstaller(store, null, dispatch, BUILT_IN));
    await Promise.resolve();

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});

// ─── useRulesetUninstaller ─────────────────────────────────────────

describe("useRulesetUninstaller", () => {
  it("deletes the ruleset and dispatches the refreshed slugs", async () => {
    const store = new MemoryRulesetStore();
    await store.save(VALID);
    const dispatch = vi.fn();

    const { result } = renderHook(() => useRulesetUninstaller(store, "war", dispatch, BUILT_IN));

    await waitFor(() => expect(slugDispatches(dispatch)).toEqual([["crazy-eights"]]));
    expect(await store.list()).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("clears pendingUninstall and reports the cause when delete throws", async () => {
    const store = new MemoryRulesetStore();
    await store.save(VALID);
    vi.spyOn(store, "delete").mockRejectedValue(new Error("locked"));
    const dispatch = vi.fn();

    const { result } = renderHook(() => useRulesetUninstaller(store, "war", dispatch, BUILT_IN));

    await waitFor(() => expect(result.current.error).toBe('Could not remove "war": locked'));
    expect(slugDispatches(dispatch)).toEqual([["crazy-eights", "war"]]);
  });
});
