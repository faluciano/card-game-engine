// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";
import { BUILT_IN_INSTALLED, BUILT_IN_RULESETS } from "./built-in-rulesets";
import { MemoryRulesetStore } from "./memory-ruleset-store";
import { useRulesetSync } from "./use-ruleset-sync";

// ─── Fixtures ──────────────────────────────────────────────────────

const VALID: CardGameRuleset = BUILT_IN_RULESETS[0]!;
const INVALID = { meta: { slug: "broken" } } as unknown as CardGameRuleset;

type SyncState = Pick<HostGameState, "pendingInstall" | "pendingUninstall">;

const IDLE: SyncState = { pendingInstall: null, pendingUninstall: null };

function lastSlugs(dispatch: ReturnType<typeof vi.fn>): readonly string[] {
  const actions = dispatch.mock.calls.map(([a]) => a as HostAction);
  const last = actions.filter((a) => a.type === "SET_INSTALLED_SLUGS").at(-1);
  if (last?.type !== "SET_INSTALLED_SLUGS") throw new Error("no SET_INSTALLED_SLUGS");
  return last.slugs.map((s) => s.slug);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────

describe("useRulesetSync", () => {
  it("seeds installed slugs from built-ins plus the store on mount", async () => {
    const store = new MemoryRulesetStore();
    const stored = { ...VALID, meta: { ...VALID.meta, slug: "war" } };
    await store.save(stored);
    const dispatch = vi.fn();

    const { result } = renderHook(() => useRulesetSync(store, IDLE, dispatch));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(lastSlugs(dispatch)).toEqual([...BUILT_IN_INSTALLED.map((b) => b.slug), "war"]);
    expect(result.current).toEqual({ loadError: null, installError: null, uninstallError: null });
  });

  it("services a pending install and reports no error", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();
    const installed = { ...VALID, meta: { ...VALID.meta, slug: "war" } };

    const { result, rerender } = renderHook(
      ({ state }: { state: SyncState }) => useRulesetSync(store, state, dispatch),
      { initialProps: { state: IDLE } },
    );
    await waitFor(() => expect(dispatch).toHaveBeenCalled());

    rerender({ state: { ...IDLE, pendingInstall: { ruleset: installed, slug: "war" } } });

    await waitFor(() => expect(lastSlugs(dispatch)).toContain("war"));
    expect(await store.getBySlug("war")).not.toBeNull();
    expect(result.current.installError).toBeNull();
  });

  it("clears a rejected install and exposes the reason as installError", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();

    const { result, rerender } = renderHook(
      ({ state }: { state: SyncState }) => useRulesetSync(store, state, dispatch),
      { initialProps: { state: IDLE } },
    );
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    const before = dispatch.mock.calls.length;

    rerender({ state: { ...IDLE, pendingInstall: { ruleset: INVALID, slug: "broken" } } });

    // A SET_INSTALLED_SLUGS still goes out so the reducer clears pendingInstall.
    await waitFor(() => expect(dispatch.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(result.current.installError).toMatch(/rejected/));
    expect(result.current.installError).toContain("Validation failed");
    expect(await store.list()).toEqual([]);
  });

  it("services a pending uninstall", async () => {
    const store = new MemoryRulesetStore();
    const stored = { ...VALID, meta: { ...VALID.meta, slug: "war" } };
    await store.save(stored);
    const dispatch = vi.fn();

    const { result, rerender } = renderHook(
      ({ state }: { state: SyncState }) => useRulesetSync(store, state, dispatch),
      { initialProps: { state: IDLE } },
    );
    await waitFor(() => expect(lastSlugs(dispatch)).toContain("war"));

    rerender({ state: { ...IDLE, pendingUninstall: "war" } });

    await waitFor(() => expect(lastSlugs(dispatch)).not.toContain("war"));
    expect(result.current.uninstallError).toBeNull();
  });

  it("falls back to built-ins and sets loadError when the store cannot be read", async () => {
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "list").mockRejectedValue(new Error("index is corrupt"));
    const dispatch = vi.fn();

    const { result } = renderHook(() => useRulesetSync(store, IDLE, dispatch));

    await waitFor(() => expect(result.current.loadError).toBe("index is corrupt"));
    expect(lastSlugs(dispatch)).toEqual(BUILT_IN_INSTALLED.map((b) => b.slug));
  });

  it("accepts a custom built-in list", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();
    const custom = [{ slug: "custom", version: "9.9.9" }];

    renderHook(() => useRulesetSync(store, IDLE, dispatch, custom));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(lastSlugs(dispatch)).toEqual(["custom"]);
  });

  it("returns a referentially stable status while errors are unchanged", async () => {
    const store = new MemoryRulesetStore();
    const dispatch = vi.fn();

    const { result, rerender } = renderHook(() => useRulesetSync(store, IDLE, dispatch));
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
