// ─── Import Modal (web) ────────────────────────────────────────────
// Web port of packages/host/src/components/ImportModal.tsx. Same
// discriminated-union state machine (idle / loading / success / error /
// duplicate); the RN Modal + D-pad focus bookkeeping becomes a plain
// overlay with real inputs and buttons.

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ImportResult } from "../host-logic/use-ruleset-store.js";
import { Button } from "./Button.js";
import { colors } from "../theme.js";

type ModalState =
  | { readonly tag: "idle" }
  | { readonly tag: "loading" }
  | { readonly tag: "success"; readonly name: string }
  | { readonly tag: "error"; readonly message: string }
  | {
      readonly tag: "duplicate";
      readonly slug: string;
      readonly suggestedSlug: string;
    };

const IDLE_STATE: ModalState = { tag: "idle" };
const LOADING_STATE: ModalState = { tag: "loading" };

const AUTO_CLOSE_DELAY_MS = 1500;

/** Returns the next available slug by appending an incrementing suffix. */
function nextAvailableSlug(base: string, existing: readonly string[]): string {
  let n = 1;
  let candidate = `${base}-${n}`;
  while (existing.includes(candidate)) {
    n++;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export function ImportModal({
  visible,
  onClose,
  onImport,
  onImportWithSlug,
  allSlugs,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onImport: (url: string) => Promise<ImportResult>;
  readonly onImportWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly allSlugs: readonly string[];
}): React.JSX.Element | null {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ModalState>(IDLE_STATE);
  const [customSlug, setCustomSlug] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [visible]);

  // Auto-close shortly after a successful import.
  useEffect(() => {
    if (state.tag !== "success") return;
    const timer = setTimeout(() => onClose(), AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, onClose]);

  const handleImport = useCallback(async () => {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;

    setState(LOADING_STATE);
    const result = await onImport(trimmed);

    if (result.ok) {
      setState({ tag: "success", name: result.name });
    } else if (result.duplicate) {
      const suggested = nextAvailableSlug(result.slug, allSlugs);
      setState({ tag: "duplicate", slug: result.slug, suggestedSlug: suggested });
    } else {
      setState({ tag: "error", message: result.error });
    }
  }, [url, onImport, allSlugs]);

  const handleImportWithSlug = useCallback(async () => {
    if (state.tag !== "duplicate") return;

    const slug = customSlug.trim() || state.suggestedSlug;
    setState(LOADING_STATE);
    const result = await onImportWithSlug(url.trim(), slug);

    if (result.ok) {
      setState({ tag: "success", name: result.name });
    } else {
      setState({ tag: "error", message: result.error });
    }
  }, [customSlug, url, onImportWithSlug, state]);

  if (!visible) return null;

  const isLoading = state.tag === "loading";
  const isDuplicate = state.tag === "duplicate";
  const isImportDisabled = url.trim().length === 0 || isLoading;

  return (
    <div
      style={styles.backdrop}
      onClick={isLoading ? undefined : onClose}
      role="presentation"
    >
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import Ruleset"
      >
        <div style={styles.title}>Import Ruleset</div>

        <input
          ref={inputRef}
          style={styles.input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImportDisabled && !isDuplicate) {
              void handleImport();
            }
          }}
          placeholder="https://example.com/game.cardgame.json"
          disabled={isLoading || isDuplicate}
          autoComplete="off"
          spellCheck={false}
        />

        {state.tag === "loading" && (
          <div style={styles.loadingText}>Importing…</div>
        )}
        {state.tag === "success" && (
          <div style={styles.successText}>
            {"✓"} {state.name} imported successfully!
          </div>
        )}
        {state.tag === "error" && (
          <div style={styles.errorText}>{state.message}</div>
        )}

        {state.tag === "duplicate" && (
          <div>
            <div style={styles.errorText}>
              A ruleset named &quot;{state.slug}&quot; already exists.
            </div>
            <div style={styles.hintText}>Choose a different name to import:</div>
            <input
              style={styles.input}
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleImportWithSlug();
              }}
              placeholder={state.suggestedSlug}
              autoComplete="off"
              spellCheck={false}
            />
            <div style={styles.buttonRow}>
              <Button
                label="Import As"
                variant="primary"
                onPress={() => void handleImportWithSlug()}
              />
              <Button label="Cancel" variant="secondary" onPress={onClose} />
            </div>
          </div>
        )}

        {!isDuplicate && (
          <div style={styles.buttonRow}>
            <Button
              label="Import"
              variant="primary"
              disabled={isImportDisabled}
              onPress={() => void handleImport()}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={isLoading}
              onPress={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    padding: 32,
    zIndex: 10,
  },
  panel: {
    width: "min(720px, 100%)",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 32,
    boxSizing: "border-box",
  },
  title: {
    color: colors.textBright,
    fontSize: 30,
    fontWeight: 700,
    marginBottom: 20,
  },
  input: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: colors.surfaceRaised,
    color: colors.textBright,
    fontSize: 20,
    fontFamily: "inherit",
    borderRadius: 10,
    borderWidth: 3,
    borderStyle: "solid",
    borderColor: colors.border,
    padding: "14px 16px",
    marginBottom: 16,
    outline: "none",
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 20,
    marginBottom: 12,
  },
  successText: {
    color: colors.success,
    fontSize: 20,
    marginBottom: 12,
  },
  errorText: {
    color: colors.danger,
    fontSize: 18,
    lineHeight: 1.4,
    marginBottom: 12,
  },
  hintText: {
    color: colors.textMuted,
    fontSize: 18,
    marginBottom: 12,
  },
  buttonRow: {
    display: "flex",
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
  },
} satisfies Record<string, React.CSSProperties>;
