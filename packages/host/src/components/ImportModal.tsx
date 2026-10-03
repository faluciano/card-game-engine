// ─── Import Modal ──────────────────────────────────────────────────
// Full-screen modal overlay for importing rulesets from a URL, designed
// for D-pad navigation on Android TV. A thin RN renderer over
// `useImportModalModel` from host-core; only the focus bookkeeping for
// the text inputs' TV highlight ring lives here (buttons get theirs
// from TVPressable).

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import {
  IMPORT_URL_PLACEHOLDER,
  colors,
  useImportModalModel,
  type ImportResult,
} from "@card-engine/host-core";
import { TVPressable } from "./TVPressable";

// ─── Types ─────────────────────────────────────────────────────────

interface ImportModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onImport: (url: string) => Promise<ImportResult>;
  readonly onImportWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly allSlugs: readonly string[];
}

/** Which text input currently holds the D-pad focus ring. */
type FocusKey = "input" | "slugInput";

// ─── Component ─────────────────────────────────────────────────────

export function ImportModal({
  visible,
  onClose,
  onImport,
  onImportWithSlug,
  allSlugs,
}: ImportModalProps): React.JSX.Element | null {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState<FocusKey | null>(null);
  const model = useImportModalModel({
    visible,
    onClose,
    onImport,
    onImportWithSlug,
    allSlugs,
    inputRef,
  });

  // Drop the focus ring when the modal closes
  useEffect(() => {
    if (!visible) setFocused(null);
  }, [visible]);

  // Early exit: don't render when not visible
  if (!visible) return null;

  const { state, isLoading, isDuplicate, isImportDisabled } = model;
  const focusProps = (key: FocusKey) => ({
    onFocus: () => setFocused(key),
    onBlur: () => setFocused(null),
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={isLoading ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.panel} accessibilityViewIsModal accessibilityLabel="Import Ruleset">
          <Text style={styles.title} accessibilityRole="header">
            Import Ruleset
          </Text>

          {/* URL Input */}
          <TextInput
            ref={inputRef}
            style={[styles.input, focused === "input" && styles.inputFocused]}
            value={model.url}
            onChangeText={model.setUrl}
            placeholder={IMPORT_URL_PLACEHOLDER}
            placeholderTextColor={colors.textFaint}
            editable={!isLoading && !isDuplicate}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Ruleset URL"
            {...focusProps("input")}
          />

          {/* Status Messages */}
          {state.tag === "loading" && (
            <Text style={styles.loadingText} accessibilityLiveRegion="polite">
              Importing...
            </Text>
          )}
          {state.tag === "success" && (
            <Text style={styles.successText} accessibilityLiveRegion="polite">
              {"✓"} {state.name} imported successfully!
            </Text>
          )}
          {state.tag === "error" && (
            <Text style={styles.errorText} accessibilityLiveRegion="assertive">
              {state.message}
            </Text>
          )}

          {/* Duplicate State */}
          {state.tag === "duplicate" && (
            <View>
              <Text style={styles.errorText} accessibilityLiveRegion="assertive">
                A ruleset named &quot;{state.slug}&quot; already exists.
              </Text>
              <Text style={styles.hintText}>Choose a different name to import:</Text>
              <TextInput
                style={[styles.input, focused === "slugInput" && styles.inputFocused]}
                value={model.customSlug}
                onChangeText={model.setCustomSlug}
                placeholder={state.suggestedSlug}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="New ruleset name"
                {...focusProps("slugInput")}
              />
              <View style={styles.buttonRow}>
                <TVPressable
                  style={[styles.button, styles.buttonPrimary]}
                  focusedStyle={styles.buttonFocused}
                  onPress={model.handleImportWithSlug}
                  accessibilityLabel="Import under the new name"
                >
                  <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>Import As</Text>
                </TVPressable>

                <TVPressable
                  style={[styles.button, styles.buttonSecondary]}
                  focusedStyle={styles.buttonFocused}
                  onPress={onClose}
                  accessibilityLabel="Cancel import"
                >
                  <Text style={[styles.buttonLabel, styles.buttonLabelSecondary]}>Cancel</Text>
                </TVPressable>
              </View>
            </View>
          )}

          {/* Normal Buttons (hidden during duplicate state) */}
          {!isDuplicate && (
            <View style={styles.buttonRow}>
              <TVPressable
                style={[styles.button, styles.buttonPrimary]}
                focusedStyle={styles.buttonFocused}
                disabledStyle={styles.buttonDisabled}
                onPress={model.handleImport}
                disabled={isImportDisabled}
                accessibilityLabel="Import ruleset"
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
              </TVPressable>

              <TVPressable
                style={[styles.button, styles.buttonSecondary]}
                focusedStyle={styles.buttonFocused}
                disabledStyle={styles.buttonDisabled}
                onPress={onClose}
                disabled={isLoading}
                accessibilityLabel="Cancel import"
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
              </TVPressable>
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
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 32,
    width: "60%",
    maxWidth: 640,
  },
  title: {
    color: colors.textBright,
    fontSize: 36,
    fontWeight: "700",
    marginBottom: 24,
    textAlign: "center",
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    color: colors.textBright,
    fontSize: 22,
    borderRadius: 12,
    padding: 16,
    borderWidth: 3,
    borderColor: "transparent",
    marginBottom: 20,
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  successText: {
    color: colors.success,
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  errorText: {
    color: colors.danger,
    fontSize: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  hintText: {
    color: colors.textMuted,
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
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonDisabled: {
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  buttonFocused: {
    borderColor: colors.textBright,
  },
  buttonLabel: {
    fontSize: 24,
    fontWeight: "700",
  },
  buttonLabelPrimary: {
    color: colors.textBright,
  },
  buttonLabelSecondary: {
    color: colors.textMuted,
  },
  buttonLabelDisabled: {
    color: colors.textFaint,
  },
});
