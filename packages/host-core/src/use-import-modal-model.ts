// ─── Import Modal Model ────────────────────────────────────────────
// State machine and handlers for the "import ruleset from URL" dialog,
// shared by the TV host (RN Modal + D-pad) and the web display (DOM
// overlay). Uses a discriminated union so illegal states are
// unrepresentable; the renderers only map it to inputs and buttons.

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import type { ImportResult } from "./use-ruleset-store";

// ─── Types ─────────────────────────────────────────────────────────

export type ImportModalState =
  | { readonly tag: "idle" }
  | { readonly tag: "loading" }
  | { readonly tag: "success"; readonly name: string }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "duplicate"; readonly slug: string; readonly suggestedSlug: string };

const IDLE_STATE: ImportModalState = { tag: "idle" };
const LOADING_STATE: ImportModalState = { tag: "loading" };

/** Delay before a successful import closes the dialog on its own. */
export const IMPORT_AUTO_CLOSE_DELAY_MS = 1500;
/** Small delay so the dialog is fully rendered before the URL field is focused. */
export const IMPORT_FOCUS_DELAY_MS = 100;

export const IMPORT_URL_PLACEHOLDER = "https://example.com/game.cardgame.json";

// ─── Pure helpers ──────────────────────────────────────────────────

/** Returns the next available slug by appending an incrementing suffix. */
export function nextAvailableSlug(base: string, existing: readonly string[]): string {
  let n = 1;
  let candidate = `${base}-${n}`;
  while (existing.includes(candidate)) {
    n++;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

/** Maps an import outcome to the dialog state that should follow it. */
export function importResultToState(
  result: ImportResult,
  allSlugs: readonly string[],
): ImportModalState {
  if (result.ok) return { tag: "success", name: result.name };
  if (result.duplicate) {
    return {
      tag: "duplicate",
      slug: result.slug,
      suggestedSlug: nextAvailableSlug(result.slug, allSlugs),
    };
  }
  return { tag: "error", message: result.error };
}

/** The slug to import under from the duplicate dialog: custom, else suggested. */
export function resolveImportSlug(customSlug: string, suggestedSlug: string): string {
  return customSlug.trim() || suggestedSlug;
}

// ─── Hook ──────────────────────────────────────────────────────────

export interface ImportModalInput {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onImport: (url: string) => Promise<ImportResult>;
  readonly onImportWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly allSlugs: readonly string[];
  /** The URL field, focused shortly after the dialog opens. */
  readonly inputRef: RefObject<{ focus(): void } | null>;
}

export interface ImportModalModel {
  readonly url: string;
  readonly setUrl: (url: string) => void;
  readonly state: ImportModalState;
  readonly customSlug: string;
  readonly setCustomSlug: (slug: string) => void;
  readonly isLoading: boolean;
  readonly isDuplicate: boolean;
  readonly isImportDisabled: boolean;
  readonly handleImport: () => Promise<void>;
  readonly handleImportWithSlug: () => Promise<void>;
}

/**
 * Dialog state and handlers. Resets when hidden, focuses the URL field
 * on open and auto-closes {@link IMPORT_AUTO_CLOSE_DELAY_MS} after a
 * successful import. All hooks run unconditionally; callers early-return
 * on `visible` after calling this.
 */
export function useImportModalModel({
  visible,
  onClose,
  onImport,
  onImportWithSlug,
  allSlugs,
  inputRef,
}: ImportModalInput): ImportModalModel {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ImportModalState>(IDLE_STATE);
  const [customSlug, setCustomSlug] = useState("");

  // Reset when the modal closes.
  useEffect(() => {
    if (!visible) {
      setUrl("");
      setState(IDLE_STATE);
      setCustomSlug("");
    }
  }, [visible]);

  // Auto-focus the URL field on open.
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => inputRef.current?.focus(), IMPORT_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, inputRef]);

  // Auto-close shortly after a successful import.
  useEffect(() => {
    if (state.tag !== "success") return;
    const timer = setTimeout(() => onClose(), IMPORT_AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, onClose]);

  const handleImport = useCallback(async () => {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;

    setState(LOADING_STATE);
    const result = await onImport(trimmed);
    setState(importResultToState(result, allSlugs));
  }, [url, onImport, allSlugs]);

  const handleImportWithSlug = useCallback(async () => {
    if (state.tag !== "duplicate") return;

    const slug = resolveImportSlug(customSlug, state.suggestedSlug);
    setState(LOADING_STATE);
    const result = await onImportWithSlug(url.trim(), slug);
    // A second duplicate is reported as a plain error here, as before.
    setState(
      result.ok ? { tag: "success", name: result.name } : { tag: "error", message: result.error },
    );
  }, [customSlug, url, onImportWithSlug, state]);

  const isLoading = state.tag === "loading";
  const isDuplicate = state.tag === "duplicate";

  return {
    url,
    setUrl,
    state,
    customSlug,
    setCustomSlug,
    isLoading,
    isDuplicate,
    isImportDisabled: url.trim().length === 0 || isLoading,
    handleImport,
    handleImportWithSlug,
  };
}
