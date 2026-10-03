// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ImportResult } from "./use-ruleset-store";
import {
  importFailureToState,
  importResultToState,
  nextAvailableSlug,
  resolveImportSlug,
  useImportModalModel,
  type ImportModalInput,
} from "./use-import-modal-model";

// ─── Hook fixtures ─────────────────────────────────────────────────

function makeInput(overrides: Partial<ImportModalInput> = {}): ImportModalInput {
  return {
    visible: true,
    onClose: vi.fn(),
    onImport: vi.fn(async (): Promise<ImportResult> => ({ ok: true, name: "War" })),
    onImportWithSlug: vi.fn(async (): Promise<ImportResult> => ({ ok: true, name: "War" })),
    allSlugs: [],
    inputRef: { current: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("nextAvailableSlug", () => {
  it("starts at -1", () => {
    expect(nextAvailableSlug("war", [])).toBe("war-1");
  });

  it("skips taken suffixes", () => {
    expect(nextAvailableSlug("war", ["war", "war-1", "war-2"])).toBe("war-3");
  });

  it("ignores unrelated slugs", () => {
    expect(nextAvailableSlug("war", ["blackjack-1"])).toBe("war-1");
  });
});

describe("importResultToState", () => {
  it("maps success", () => {
    expect(importResultToState({ ok: true, name: "War" }, [])).toEqual({
      tag: "success",
      name: "War",
    });
  });

  it("maps a duplicate with a suggested slug", () => {
    const result = importResultToState(
      { ok: false, duplicate: true, slug: "war", error: "exists" },
      ["war", "war-1"],
    );
    expect(result).toEqual({ tag: "duplicate", slug: "war", suggestedSlug: "war-2" });
  });

  it("maps an error", () => {
    expect(importResultToState({ ok: false, error: "HTTP 404" }, [])).toEqual({
      tag: "error",
      message: "HTTP 404",
    });
  });
});

describe("resolveImportSlug", () => {
  it("prefers the trimmed custom slug", () => {
    expect(resolveImportSlug("  my-war ", "war-1")).toBe("my-war");
  });

  it("falls back to the suggestion when blank", () => {
    expect(resolveImportSlug("   ", "war-1")).toBe("war-1");
  });
});

describe("importFailureToState", () => {
  it("maps a thrown Error to an error state", () => {
    expect(importFailureToState(new Error("disk full"))).toEqual({
      tag: "error",
      message: "Import failed: disk full",
    });
  });

  it("maps a non-Error throw to an error state", () => {
    expect(importFailureToState("nope")).toEqual({ tag: "error", message: "Import failed: nope" });
  });
});

// ─── useImportModalModel ───────────────────────────────────────────

describe("useImportModalModel", () => {
  it("moves to success when the import succeeds", async () => {
    const { result } = renderHook(() => useImportModalModel(makeInput()));
    act(() => result.current.setUrl("https://example.com/war.json"));

    await act(async () => {
      await result.current.handleImport();
    });

    expect(result.current.state).toEqual({ tag: "success", name: "War" });
  });

  it("leaves loading for an error state when onImport throws", async () => {
    const onImport = vi.fn(async (): Promise<ImportResult> => {
      throw new Error("disk full");
    });
    const { result } = renderHook(() => useImportModalModel(makeInput({ onImport })));
    act(() => result.current.setUrl("https://example.com/war.json"));

    await act(async () => {
      await expect(result.current.handleImport()).resolves.toBeUndefined();
    });

    expect(result.current.state).toEqual({ tag: "error", message: "Import failed: disk full" });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isImportDisabled).toBe(false);
  });

  it("leaves loading for an error state when onImportWithSlug throws", async () => {
    const onImport = vi.fn(
      async (): Promise<ImportResult> => ({
        ok: false,
        duplicate: true,
        slug: "war",
        error: "exists",
      }),
    );
    const onImportWithSlug = vi.fn(async (): Promise<ImportResult> => {
      throw new Error("quota");
    });
    const { result } = renderHook(() =>
      useImportModalModel(makeInput({ onImport, onImportWithSlug, allSlugs: ["war"] })),
    );
    act(() => result.current.setUrl("https://example.com/war.json"));
    await act(async () => {
      await result.current.handleImport();
    });
    expect(result.current.state.tag).toBe("duplicate");

    await act(async () => {
      await result.current.handleImportWithSlug();
    });

    expect(onImportWithSlug).toHaveBeenCalledWith("https://example.com/war.json", "war-1");
    expect(result.current.state).toEqual({ tag: "error", message: "Import failed: quota" });
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores a result that arrives after the dialog was closed", async () => {
    let resolveImport: (r: ImportResult) => void = () => {};
    const onImport = vi.fn(
      () =>
        new Promise<ImportResult>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) => useImportModalModel(makeInput({ visible, onImport })),
      { initialProps: { visible: true } },
    );
    act(() => result.current.setUrl("https://example.com/war.json"));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.handleImport();
    });
    rerender({ visible: false });
    await act(async () => {
      resolveImport({ ok: true, name: "War" });
      await pending;
    });

    expect(result.current.state).toEqual({ tag: "idle" });
  });
});
