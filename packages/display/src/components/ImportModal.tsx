// ─── Import Modal (web) ────────────────────────────────────────────
// Thin DOM renderer over `useImportModalModel` from host-core,
// mirroring packages/host/src/components/ImportModal.tsx. The RN Modal
// + D-pad focus bookkeeping becomes a plain overlay with real inputs
// and buttons.

import type React from "react";
import { useRef } from "react";
import {
  IMPORT_URL_PLACEHOLDER,
  colors,
  useImportModalModel,
  type ImportResult,
} from "@card-engine/host-core";
import { Button } from "./Button.js";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const model = useImportModalModel({
    visible,
    onClose,
    onImport,
    onImportWithSlug,
    allSlugs,
    inputRef,
  });

  if (!visible) return null;

  const { state, isLoading, isDuplicate, isImportDisabled } = model;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a pointer-only convenience; keyboard users close the dialog with Escape (handled on the dialog panel) or the Cancel button
    <div style={styles.backdrop} onClick={isLoading ? undefined : onClose} role="presentation">
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isLoading) {
            onClose();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Import Ruleset"
      >
        <div style={styles.title}>Import Ruleset</div>

        <input
          ref={inputRef}
          style={styles.input}
          value={model.url}
          onChange={(e) => model.setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImportDisabled && !isDuplicate) {
              void model.handleImport();
            }
          }}
          placeholder={IMPORT_URL_PLACEHOLDER}
          disabled={isLoading || isDuplicate}
          autoComplete="off"
          spellCheck={false}
        />

        {state.tag === "loading" && <div style={styles.loadingText}>Importing…</div>}
        {state.tag === "success" && (
          <div style={styles.successText}>
            {"✓"} {state.name} imported successfully!
          </div>
        )}
        {state.tag === "error" && <div style={styles.errorText}>{state.message}</div>}

        {state.tag === "duplicate" && (
          <div>
            <div style={styles.errorText}>
              A ruleset named &quot;{state.slug}&quot; already exists.
            </div>
            <div style={styles.hintText}>Choose a different name to import:</div>
            <input
              style={styles.input}
              value={model.customSlug}
              onChange={(e) => model.setCustomSlug(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void model.handleImportWithSlug();
              }}
              placeholder={state.suggestedSlug}
              autoComplete="off"
              spellCheck={false}
            />
            <div style={styles.buttonRow}>
              <Button
                label="Import As"
                variant="primary"
                onPress={() => void model.handleImportWithSlug()}
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
              onPress={() => void model.handleImport()}
            />
            <Button label="Cancel" variant="secondary" disabled={isLoading} onPress={onClose} />
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
