// ─── Import Modal ──────────────────────────────────────────────────
// Full-screen modal overlay for importing rulesets from a URL.
// Designed for D-pad navigation on Android TV. Uses a discriminated
// union for internal state to make illegal states unrepresentable.

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ImportResult } from "../hooks/useRulesetStore";

// ─── Types ─────────────────────────────────────────────────────────

interface ImportModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onImport: (url: string) => Promise<ImportResult>;
  readonly onImportWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly allSlugs: readonly string[];
}

type ModalState =
  | { readonly tag: "idle" }
  | { readonly tag: "loading" }
  | { readonly tag: "success"; readonly name: string }
  | { readonly tag: "error"; readonly message: string }
  | { readonly tag: "duplicate"; readonly slug: string; readonly suggestedSlug: string };

const IDLE_STATE: ModalState = { tag: "idle" };
const LOADING_STATE: ModalState = { tag: "loading" };

const AUTO_CLOSE_DELAY_MS = 1500;

// ─── Helpers ───────────────────────────────────────────────────────

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

// ─── Component ─────────────────────────────────────────────────────

export function ImportModal({
  visible,
  onClose,
  onImport,
  onImportWithSlug,
  allSlugs,
}: ImportModalProps): React.JSX.Element | null {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ModalState>(IDLE_STATE);
  const [customSlug, setCustomSlug] = useState("");
  const [importFocused, setImportFocused] = useState(false);
  const [cancelFocused, setCancelFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [slugInputFocused, setSlugInputFocused] = useState(false);
  const [importAsFocused, setImportAsFocused] = useState(false);
  const [duplicateCancelFocused, setDuplicateCancelFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setUrl("");
      setState(IDLE_STATE);
      setCustomSlug("");
      setImportFocused(false);
      setCancelFocused(false);
      setInputFocused(false);
      setSlugInputFocused(false);
      setImportAsFocused(false);
      setDuplicateCancelFocused(false);
    }
  }, [visible]);

  // Auto-focus the TextInput when modal opens
  useEffect(() => {
    if (visible) {
      // Small delay to ensure the modal is fully rendered before focusing
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Auto-close on success after delay
  useEffect(() => {
    if (state.tag !== "success") return;

    const timer = setTimeout(() => {
      onClose();
    }, AUTO_CLOSE_DELAY_MS);

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

  // Early exit: don't render when not visible
  if (!visible) return null;

  const isLoading = state.tag === "loading";
  const isDuplicate = state.tag === "duplicate";
  const isImportDisabled = url.trim().length === 0 || isLoading;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={isLoading ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <Text style={styles.title}>Import Ruleset</Text>

          {/* URL Input */}
          <TextInput
            ref={inputRef}
            style={[styles.input, inputFocused && styles.inputFocused]}
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/game.cardgame.json"
            placeholderTextColor="#666666"
            editable={!isLoading && !isDuplicate}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />

          {/* Status Messages */}
          {state.tag === "loading" && (
            <Text style={styles.loadingText}>Importing...</Text>
          )}
          {state.tag === "success" && (
            <Text style={styles.successText}>
              {"\u2713"} {state.name} imported successfully!
            </Text>
          )}
          {state.tag === "error" && (
            <Text style={styles.errorText}>{state.message}</Text>
          )}

          {/* Duplicate State */}
          {state.tag === "duplicate" && (
            <View>
              <Text style={styles.errorText}>
                A ruleset named &quot;{state.slug}&quot; already exists.
              </Text>
              <Text style={styles.hintText}>Choose a different name to import:</Text>
              <TextInput
                style={[styles.input, slugInputFocused && styles.inputFocused]}
                value={customSlug}
                onChangeText={setCustomSlug}
                placeholder={state.suggestedSlug}
                placeholderTextColor="#666666"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setSlugInputFocused(true)}
                onBlur={() => setSlugInputFocused(false)}
              />
              <View style={styles.buttonRow}>
                <Pressable
                  style={[
                    styles.button,
                    styles.buttonPrimary,
                    importAsFocused && styles.buttonFocused,
                  ]}
                  onFocus={() => setImportAsFocused(true)}
                  onBlur={() => setImportAsFocused(false)}
                  onPress={handleImportWithSlug}
                >
                  <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>
                    Import As
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.button,
                    styles.buttonSecondary,
                    duplicateCancelFocused && styles.buttonFocused,
                  ]}
                  onFocus={() => setDuplicateCancelFocused(true)}
                  onBlur={() => setDuplicateCancelFocused(false)}
                  onPress={onClose}
                >
                  <Text style={[styles.buttonLabel, styles.buttonLabelSecondary]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Normal Buttons (hidden during duplicate state) */}
          {!isDuplicate && (
            <View style={styles.buttonRow}>
              <Pressable
                style={[
                  styles.button,
                  styles.buttonPrimary,
                  isImportDisabled && styles.buttonDisabled,
                  importFocused && !isImportDisabled && styles.buttonFocused,
                ]}
                onFocus={() => setImportFocused(true)}
                onBlur={() => setImportFocused(false)}
                onPress={handleImport}
                disabled={isImportDisabled}
              >
                <Text
                  style={[
                    styles.buttonLabel,
                    styles.buttonLabelPrimary,
                    isImportDisabled && styles.buttonLabelDisabled,
                  ]}
                >
                  Import
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.button,
                  styles.buttonSecondary,
                  isLoading && styles.buttonDisabled,
                  cancelFocused && !isLoading && styles.buttonFocused,
                ]}
                onFocus={() => setCancelFocused(true)}
                onBlur={() => setCancelFocused(false)}
                onPress={onClose}
                disabled={isLoading}
              >
                <Text
                  style={[
                    styles.buttonLabel,
                    styles.buttonLabelSecondary,
                    isLoading && styles.buttonLabelDisabled,
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    backgroundColor: "#1e1e1e",
    borderRadius: 16,
    padding: 32,
    width: "60%",
    maxWidth: 640,
  },
  title: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "700",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#2a2a2a",
    color: "#ffffff",
    fontSize: 22,
    borderRadius: 12,
    padding: 16,
    borderWidth: 3,
    borderColor: "transparent",
    marginBottom: 20,
  },
  inputFocused: {
    borderColor: "#7c4dff",
  },
  loadingText: {
    color: "#b0b0b0",
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  successText: {
    color: "#4caf50",
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  errorText: {
    color: "#ff5252",
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  hintText: {
    color: "#b0b0b0",
    fontSize: 18,
    marginBottom: 12,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 8,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 3,
    borderColor: "transparent",
  },
  buttonPrimary: {
    backgroundColor: "#7c4dff",
  },
  buttonSecondary: {
    backgroundColor: "#2a2a2a",
  },
  buttonDisabled: {
    backgroundColor: "#333333",
    opacity: 0.5,
  },
  buttonFocused: {
    borderColor: "#ffffff",
  },
  buttonLabel: {
    fontSize: 24,
    fontWeight: "700",
  },
  buttonLabelPrimary: {
    color: "#ffffff",
  },
  buttonLabelSecondary: {
    color: "#b0b0b0",
  },
  buttonLabelDisabled: {
    color: "#666666",
  },
});
