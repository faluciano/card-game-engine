// ─── Ruleset Picker Screen ─────────────────────────────────────────
// Displays available rulesets and allows the user to select one.
// Built-in rulesets are loaded at build time; user-imported rulesets
// will be wired through RulesetStore in a future integration pass.

import React, { useMemo, useState, useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGameHost } from "@couch-kit/host";
import { loadRuleset } from "@card-engine/shared";
import type { CardGameRuleset } from "@card-engine/shared";
import type { HostAction, HostGameState } from "../types/host-state";
import blackjackJson from "../../../../rulesets/blackjack.cardgame.json";

// ─── Built-in Rulesets ─────────────────────────────────────────────

/**
 * Parse built-in rulesets once at module level.
 * Throws fast at startup if the bundled JSON is malformed.
 */
const BUILT_IN_RULESETS: readonly CardGameRuleset[] = [
  loadRuleset(blackjackJson),
];

// ─── Types ─────────────────────────────────────────────────────────

interface RulesetItem {
  readonly ruleset: CardGameRuleset;
  readonly source: "built_in" | "imported";
}

// ─── Component ─────────────────────────────────────────────────────

export function RulesetPicker(): React.JSX.Element {
  const { dispatch } = useGameHost<HostGameState, HostAction>();

  // User-imported rulesets — placeholder for future RulesetStore integration
  const [importedRulesets] = useState<readonly CardGameRuleset[]>([]);

  const rulesetItems: readonly RulesetItem[] = useMemo(() => {
    const builtIn: RulesetItem[] = BUILT_IN_RULESETS.map(
      (rs: CardGameRuleset): RulesetItem => ({
        ruleset: rs,
        source: "built_in" as const,
      }),
    );
    const imported: RulesetItem[] = importedRulesets.map(
      (rs: CardGameRuleset): RulesetItem => ({
        ruleset: rs,
        source: "imported" as const,
      }),
    );
    return [...builtIn, ...imported];
  }, [importedRulesets]);

  const handleSelect = useCallback(
    (ruleset: CardGameRuleset) => {
      dispatch({ type: "SELECT_RULESET", ruleset });
    },
    [dispatch],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CHOOSE A GAME</Text>

      <ScrollView contentContainerStyle={styles.listContent}>
        <View style={styles.grid}>
          {rulesetItems.map((item, index) => (
            <RulesetCard
              key={item.ruleset.meta.slug}
              item={item}
              onSelect={handleSelect}
              isFirst={index === 0}
            />
          ))}
        </View>
        <ImportPlaceholder />
      </ScrollView>
    </View>
  );
}

// ─── Ruleset Card ──────────────────────────────────────────────────

function RulesetCard({
  item,
  onSelect,
  isFirst,
}: {
  readonly item: RulesetItem;
  readonly onSelect: (ruleset: CardGameRuleset) => void;
  readonly isFirst: boolean;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const { meta } = item.ruleset;

  const playerRange =
    meta.players.min === meta.players.max
      ? `${meta.players.min} players`
      : `${meta.players.min}–${meta.players.max} players`;

  return (
    <Pressable
      style={[styles.card, focused && styles.cardFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item.ruleset)}
      hasTVPreferredFocus={isFirst}
    >
      <Text style={styles.cardName}>{meta.name}</Text>
      <Text style={styles.cardMeta}>by {meta.author}</Text>
      <Text style={styles.cardMeta}>{playerRange}</Text>
      <Text style={styles.cardVersion}>v{meta.version}</Text>
      {item.source === "built_in" && (
        <Text style={styles.badge}>BUILT-IN</Text>
      )}
    </Pressable>
  );
}

// ─── Import Placeholder ────────────────────────────────────────────

function ImportPlaceholder(): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      style={[styles.importButton, focused && styles.importButtonFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => {
        // TODO: Wire to FileImporter / URLImporter when storage integration is ready
      }}
    >
      <Text style={styles.importIcon}>+</Text>
      <Text style={styles.importLabel}>Import Ruleset</Text>
    </Pressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    paddingHorizontal: 48,
    paddingTop: 48,
  },
  title: {
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 32,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: 48,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 24,
    marginBottom: 24,
  },
  card: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: "#1e1e1e",
    borderRadius: 16,
    padding: 28,
    borderWidth: 3,
    borderColor: "transparent",
  },
  cardFocused: {
    borderColor: "#7c4dff",
    backgroundColor: "#2a2a2a",
  },
  cardName: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
  },
  cardMeta: {
    color: "#b0b0b0",
    fontSize: 22,
    lineHeight: 30,
  },
  cardVersion: {
    color: "#666666",
    fontSize: 18,
    marginTop: 12,
  },
  badge: {
    color: "#7c4dff",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
    letterSpacing: 1,
  },
  importButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e1e1e",
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 3,
    borderColor: "transparent",
    borderStyle: "dashed",
  },
  importButtonFocused: {
    borderColor: "#7c4dff",
    backgroundColor: "#2a2a2a",
  },
  importIcon: {
    color: "#7c4dff",
    fontSize: 36,
    fontWeight: "300",
    marginRight: 16,
  },
  importLabel: {
    color: "#b0b0b0",
    fontSize: 24,
    fontWeight: "500",
  },
});
