// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CardGameRuleset } from "@card-engine/shared";
import type { RulesetStore } from "./ruleset-store";
import { BUILT_IN_RULESETS } from "./built-in-rulesets";
import { MemoryRulesetStore } from "./memory-ruleset-store";
import { useRulesetStore } from "./use-ruleset-store";

// ─── Fixtures ──────────────────────────────────────────────────────

const VALID: CardGameRuleset = BUILT_IN_RULESETS[0]!;
const URL = "https://example.com/game.cardgame.json";

type SyncedSlugs = readonly { slug: string; version: string }[];
const NO_SLUGS: SyncedSlugs = [];

/** Stubs fetch so url-importer resolves to `body` with a 200. */
function stubFetchWith(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    })),
  );
}

/** A store whose every method rejects with `err`. */
function brokenStore(err: Error): RulesetStore {
  const reject = async () => {
    throw err;
  };
  return {
    list: reject,
    getById: reject,
    save: reject,
    saveWithSlug: reject,
    delete: reject,
    getBySlug: reject,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Loading ───────────────────────────────────────────────────────

describe("useRulesetStore — loading", () => {
  it("loads rulesets on mount and clears isLoading", async () => {
    const store = new MemoryRulesetStore();
    await store.save(VALID);

    const { result } = renderHook(() => useRulesetStore(store, []));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rulesets).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.allSlugs).toEqual([VALID.meta.slug]);
  });

  it("surfaces a failed initial load through error and still clears isLoading", async () => {
    const store = brokenStore(new Error("index is corrupt"));

    const { result } = renderHook(() => useRulesetStore(store, ["built-in"]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("index is corrupt");
    expect(result.current.rulesets).toEqual([]);
    expect(result.current.allSlugs).toEqual(["built-in"]);
  });

  it("does not update state after unmount", async () => {
    let resolveList: (v: readonly never[]) => void = () => {};
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "list").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useRulesetStore(store, []));
    unmount();
    await act(async () => {
      resolveList([]);
    });

    // The last observed render still reports loading: nothing ran after unmount.
    expect(result.current.isLoading).toBe(true);
  });

  it("re-reads the store when the synced slug list changes", async () => {
    const store = new MemoryRulesetStore();
    const listSpy = vi.spyOn(store, "list");

    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: readonly { slug: string; version: string }[] }) =>
        useRulesetStore(store, [], slugs),
      { initialProps: { slugs: NO_SLUGS } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsAfterMount = listSpy.mock.calls.length;

    await store.save(VALID);
    rerender({ slugs: [{ slug: VALID.meta.slug, version: VALID.meta.version }] });

    await waitFor(() => expect(result.current.rulesets).toHaveLength(1));
    expect(listSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("records a refresh failure in error and clears it on the next good read", async () => {
    const store = new MemoryRulesetStore();
    const { result, rerender } = renderHook(
      ({ slugs }: { slugs: readonly { slug: string; version: string }[] }) =>
        useRulesetStore(store, [], slugs),
      { initialProps: { slugs: NO_SLUGS } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    vi.spyOn(store, "list").mockRejectedValueOnce(new Error("disk went away"));
    rerender({ slugs: [{ slug: "x", version: "1" }] });
    await waitFor(() => expect(result.current.error).toBe("disk went away"));

    rerender({ slugs: [{ slug: "y", version: "1" }] });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});

// ─── Importing ─────────────────────────────────────────────────────

describe("useRulesetStore — importFromUrl", () => {
  it("saves and refreshes on success", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.importFromUrl>> | undefined;
    await act(async () => {
      outcome = await result.current.importFromUrl(URL);
    });

    expect(outcome).toEqual({ ok: true, name: VALID.meta.name });
    expect(result.current.rulesets).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("reports a built-in slug as a duplicate without touching the store", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    const saveSpy = vi.spyOn(store, "save");
    const { result } = renderHook(() => useRulesetStore(store, [VALID.meta.slug]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await result.current.importFromUrl(URL);

    expect(outcome).toMatchObject({ ok: false, duplicate: true, slug: VALID.meta.slug });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("reports an already-stored slug as a duplicate", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    await store.save(VALID);
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await result.current.importFromUrl(URL);

    expect(outcome).toMatchObject({ ok: false, duplicate: true, slug: VALID.meta.slug });
  });

  it("passes a fetch/validation failure through unchanged", async () => {
    stubFetchWith({ nope: true });
    const store = new MemoryRulesetStore();
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await result.current.importFromUrl(URL);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.duplicate).toBeUndefined();
    expect(outcome.error).toMatch(/^Validation failed/);
    // Validation failures are the caller's problem, not store health.
    expect(result.current.error).toBeNull();
  });

  it("returns { ok: false } and records error when the store rejects the save", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "save").mockRejectedValue(new Error("storage is full"));
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.importFromUrl>> | undefined;
    await act(async () => {
      outcome = await result.current.importFromUrl(URL);
    });

    expect(outcome).toEqual({
      ok: false,
      error: `Could not save "${VALID.meta.name}": storage is full`,
    });
    expect(result.current.error).toBe(`Could not save "${VALID.meta.name}": storage is full`);
  });

  it("returns { ok: false } when the duplicate check itself fails", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "getBySlug").mockRejectedValue(new Error("index is corrupt"));
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.importFromUrl>> | undefined;
    await act(async () => {
      outcome = await result.current.importFromUrl(URL);
    });

    expect(outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining("index is corrupt"),
    });
  });
});

describe("useRulesetStore — importWithSlug", () => {
  it("saves under the override slug", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.importWithSlug>> | undefined;
    await act(async () => {
      outcome = await result.current.importWithSlug(URL, "custom-slug");
    });

    expect(outcome).toEqual({ ok: true, name: VALID.meta.name });
    expect(await store.getBySlug("custom-slug")).not.toBeNull();
  });

  it("returns { ok: false } instead of rejecting when the save throws", async () => {
    stubFetchWith(VALID);
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "saveWithSlug").mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: Awaited<ReturnType<typeof result.current.importWithSlug>> | undefined;
    await act(async () => {
      outcome = await result.current.importWithSlug(URL, "custom-slug");
    });

    expect(outcome).toEqual({ ok: false, error: `Could not save "${VALID.meta.name}": boom` });
  });
});

// ─── Deleting ──────────────────────────────────────────────────────

describe("useRulesetStore — deleteRuleset", () => {
  it("deletes and refreshes", async () => {
    const store = new MemoryRulesetStore();
    const saved = await store.save(VALID);
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.rulesets).toHaveLength(1));

    await act(async () => {
      await result.current.deleteRuleset(saved.id);
    });

    expect(result.current.rulesets).toEqual([]);
  });

  it("does not reject on failure; records error instead", async () => {
    const store = new MemoryRulesetStore();
    vi.spyOn(store, "delete").mockRejectedValue(new Error("locked"));
    const { result } = renderHook(() => useRulesetStore(store, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteRuleset("mem-1")).resolves.toBeUndefined();
    });

    expect(result.current.error).toBe("Could not delete ruleset: locked");
  });
});
