// ─── Ruleset Picker Screen ─────────────────────────────────────────
// Displays available rulesets and allows the user to select one.
// Built-in rulesets are loaded at build time; user-imported rulesets
// are persisted via FileRulesetStore and managed through useRulesetStore.

import React, { useMemo, useState, useCallback } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { CardGameRuleset, CatalogGame, InstalledGame } from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";
import type { HostAction, HostGameState } from "../types/host-state";
import { useRulesetStore } from "../hooks/useRulesetStore";
import { useCatalog, CATALOG_BASE_URL } from "../hooks/useCatalog";
import { ImportModal } from "../components/ImportModal";
import { QRDisplay } from "../components/QRDisplay";
import { BUILT_IN_RULESETS, BUILT_IN_SLUGS } from "../built-in-rulesets";
import { colors } from "../theme";

// ─── Types ─────────────────────────────────────────────────────────

interface RulesetItem {
  readonly id: string | null;
  readonly ruleset: CardGameRuleset;
  readonly source: "built_in" | "imported";
}

// ─── Component ─────────────────────────────────────────────────────

export function RulesetPicker(): React.JSX.Element {
  const { state, dispatch, serverUrl } = useGameHost<HostGameState, HostAction>();
  const {
    rulesets: storedRulesets,
    isLoading,
    importFromUrl,
    importWithSlug,
    allSlugs,
  } = useRulesetStore(BUILT_IN_SLUGS, state.installedSlugs);
  const [modalVisible, setModalVisible] = useState(false);
  const [tab, setTab] = useState<"library" | "store">("library");

  const rulesetItems: readonly RulesetItem[] = useMemo(() => {
    const builtIn: RulesetItem[] = BUILT_IN_RULESETS.map(
      (rs: CardGameRuleset): RulesetItem => ({
        id: null,
        ruleset: rs,
        source: "built_in" as const,
      }),
    );
    const imported: RulesetItem[] = storedRulesets.map(
      (stored): RulesetItem => ({
        id: stored.id,
        ruleset: stored.ruleset,
        source: "imported" as const,
      }),
    );
    return [...builtIn, ...imported];
  }, [storedRulesets]);

  const handleSelect = useCallback(
    (ruleset: CardGameRuleset) => {
      dispatch({ type: "SELECT_RULESET", ruleset });
    },
    [dispatch],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CHOOSE A GAME</Text>
        <View style={styles.qrSection}>
          <QRDisplay url={serverUrl} size={100} />
          <Text style={styles.qrHint}>Scan to connect{"\n"}your phone</Text>
        </View>
      </View>

      <TabBar tab={tab} onChange={setTab} />

      {tab === "store" ? (
        <StoreView
          installedSlugs={state.installedSlugs}
          builtInSlugs={BUILT_IN_SLUGS}
          dispatch={dispatch}
        />
      ) : isLoading ? (
        <Text style={styles.loadingText}>Loading rulesets...</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          <View style={styles.grid}>
            {rulesetItems.map((item, index) => (
              <RulesetCard
                key={item.id ?? `builtin:${item.ruleset.meta.slug}`}
                item={item}
                onSelect={handleSelect}
                isFirst={index === 0}
                onDelete={
                  item.source === "imported" && item.id != null
                    ? () =>
                        dispatch({
                          type: "UNINSTALL_RULESET",
                          slug: item.ruleset.meta.slug,
                        })
                    : undefined
                }
              />
            ))}
          </View>
          <ImportPlaceholder onPress={() => setModalVisible(true)} />
        </ScrollView>
      )}

      <ImportModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onImport={importFromUrl}
        onImportWithSlug={importWithSlug}
        allSlugs={allSlugs}
      />
    </View>
  );
}

// ─── Ruleset Card ──────────────────────────────────────────────────

const RulesetCard = React.memo(function RulesetCard({
  item,
  onSelect,
  isFirst,
  onDelete,
}: {
  readonly item: RulesetItem;
  readonly onSelect: (ruleset: CardGameRuleset) => void;
  readonly isFirst: boolean;
  readonly onDelete?: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [deleteFocused, setDeleteFocused] = useState(false);
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
      <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">{meta.name}</Text>
      <Text style={styles.cardMeta} numberOfLines={1} ellipsizeMode="tail">by {meta.author}</Text>
      <Text style={styles.cardMeta}>{playerRange}</Text>
      <Text style={styles.cardVersion}>v{meta.version}</Text>
      {item.source === "built_in" && (
        <Text style={styles.badge}>BUILT-IN</Text>
      )}
      {onDelete != null && (
        <Pressable
          style={[
            styles.deleteButton,
            deleteFocused && styles.deleteButtonFocused,
          ]}
          onFocus={() => setDeleteFocused(true)}
          onBlur={() => setDeleteFocused(false)}
          onPress={onDelete}
        >
          <Text style={styles.deleteLabel}>DELETE</Text>
        </Pressable>
      )}
    </Pressable>
  );
});

// ─── Import Placeholder ────────────────────────────────────────────

function ImportPlaceholder({
  onPress,
}: {
  readonly onPress: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      style={[styles.importButton, focused && styles.importButtonFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
    >
      <Text style={styles.importIcon}>+</Text>
      <Text style={styles.importLabel}>Import Ruleset</Text>
    </Pressable>
  );
}

// ─── Tab Bar ───────────────────────────────────────────────────────

const TABS: readonly { readonly key: "library" | "store"; readonly label: string }[] = [
  { key: "library", label: "My Games" },
  { key: "store", label: "Store" },
];

function TabBar({
  tab,
  onChange,
}: {
  readonly tab: "library" | "store";
  readonly onChange: (tab: "library" | "store") => void;
}): React.JSX.Element {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = tab === t.key;
        const focused = focusedKey === t.key;
        return (
          <Pressable
            key={t.key}
            style={[
              styles.tab,
              active && styles.tabActive,
              focused && styles.tabFocused,
            ]}
            onFocus={() => setFocusedKey(t.key)}
            onBlur={() => setFocusedKey(null)}
            onPress={() => onChange(t.key)}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Store View (catalog browse + install) ─────────────────────────

function StoreView({
  installedSlugs,
  builtInSlugs,
  dispatch,
}: {
  readonly installedSlugs: readonly InstalledGame[];
  readonly builtInSlugs: readonly string[];
  readonly dispatch: (action: HostAction) => void;
}): React.JSX.Element {
  const { catalog, refetch } = useCatalog();
  const [installing, setInstalling] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleInstall = useCallback(
    async (game: CatalogGame): Promise<void> => {
      setError(null);
      setInstalling((prev) => new Set(prev).add(game.slug));
      try {
        const res = await fetch(`${CATALOG_BASE_URL}${game.file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const raw: unknown = await res.json();
        const result = safeParseRuleset(raw);
        if (!result.success) throw new Error("Invalid ruleset format");

        dispatch({
          type: "INSTALL_RULESET",
          ruleset: result.data as CardGameRuleset,
          slug: game.slug,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Install failed";
        setError(`Could not install ${game.name}: ${message}`);
      } finally {
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(game.slug);
          return next;
        });
      }
    },
    [dispatch],
  );

  const handleUninstall = useCallback(
    (game: CatalogGame): void => {
      setError(null);
      dispatch({ type: "UNINSTALL_RULESET", slug: game.slug });
    },
    [dispatch],
  );

  if (catalog.tag === "loading") {
    return <Text style={styles.loadingText}>Loading store...</Text>;
  }

  if (catalog.tag === "error") {
    return (
      <View style={styles.storeMessage}>
        <Text style={styles.loadingText}>Couldn't load the store</Text>
        <Text style={styles.storeError}>{catalog.message}</Text>
        <RetryButton onPress={refetch} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      {error != null && <Text style={styles.storeError}>{error}</Text>}
      {catalog.games.length === 0 ? (
        <Text style={styles.loadingText}>No games available yet</Text>
      ) : (
        <View style={styles.grid}>
          {catalog.games.map((game) => {
            const installed = installedSlugs.find((s) => s.slug === game.slug);
            return (
              <StoreCard
                key={game.slug}
                game={game}
                installedVersion={installed?.version ?? null}
                installing={installing.has(game.slug)}
                isBuiltIn={builtInSlugs.includes(game.slug)}
                onInstall={() => handleInstall(game)}
                onUninstall={() => handleUninstall(game)}
              />
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Store Card ────────────────────────────────────────────────────

const StoreCard = React.memo(function StoreCard({
  game,
  installedVersion,
  installing,
  isBuiltIn,
  onInstall,
  onUninstall,
}: {
  readonly game: CatalogGame;
  readonly installedVersion: string | null;
  readonly installing: boolean;
  readonly isBuiltIn: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}): React.JSX.Element {
  const isInstalled = installedVersion !== null;
  const isUpdate = isInstalled && installedVersion !== game.version;

  const playerRange =
    game.players.min === game.players.max
      ? `${game.players.min} players`
      : `${game.players.min}–${game.players.max} players`;

  const actions: readonly StoreAction[] = installing
    ? [{ label: "...", variant: "disabled" }]
    : !isInstalled
      ? [{ label: "GET", variant: "primary", onPress: onInstall }]
      : [
          ...(isUpdate
            ? [{ label: "UPDATE", variant: "primary", onPress: onInstall } as const]
            : []),
          ...(isBuiltIn
            ? isUpdate
              ? []
              : [{ label: "BUILT-IN", variant: "disabled" } as const]
            : [{ label: "REMOVE", variant: "danger", onPress: onUninstall } as const]),
        ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
        {game.name}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1} ellipsizeMode="tail">
        by {game.author}
      </Text>
      <Text style={styles.cardMeta}>{playerRange}</Text>
      {game.description != null && game.description !== "" && (
        <Text style={styles.cardDesc} numberOfLines={2} ellipsizeMode="tail">
          {game.description}
        </Text>
      )}
      <Text style={styles.cardVersion}>v{game.version}</Text>
      <View style={styles.actionsRow}>
        {actions.map((action) => (
          <ActionButton key={action.label} action={action} />
        ))}
      </View>
    </View>
  );
});

// ─── Store Action Button ───────────────────────────────────────────

type StoreAction =
  | { readonly label: string; readonly variant: "primary" | "danger"; readonly onPress: () => void }
  | { readonly label: string; readonly variant: "disabled"; readonly onPress?: undefined };

function ActionButton({ action }: { readonly action: StoreAction }): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const isDisabled = action.variant === "disabled";
  const isDanger = action.variant === "danger";

  return (
    <Pressable
      style={[
        styles.getButton,
        isDanger && styles.removeButton,
        isDisabled && styles.getButtonDisabled,
        focused && !isDisabled && (isDanger ? styles.removeButtonFocused : styles.getButtonFocused),
      ]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={action.onPress}
      disabled={isDisabled}
    >
      <Text
        style={[
          styles.getLabel,
          isDanger && styles.removeLabel,
          isDisabled && styles.getLabelDisabled,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

// ─── Retry Button ──────────────────────────────────────────────────

function RetryButton({
  onPress,
}: {
  readonly onPress: () => void;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[styles.getButton, focused && styles.getButtonFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      hasTVPreferredFocus
    >
      <Text style={styles.getLabel}>RETRY</Text>
    </Pressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 48,
    paddingTop: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    color: colors.textBright,
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: 2,
  },
  qrSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qrHint: {
    color: colors.textDim,
    fontSize: 18,
    lineHeight: 26,
  },
  listContent: {
    paddingBottom: 48,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 16,
  },
  card: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 3,
    borderColor: "transparent",
  },
  cardFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  cardName: {
    color: colors.textBright,
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 17,
    lineHeight: 23,
  },
  cardVersion: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 6,
  },
  badge: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
    letterSpacing: 1,
  },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  deleteButtonFocused: {
    borderColor: colors.danger,
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 28,
    textAlign: "center",
    marginTop: 64,
  },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: "transparent",
  },
  tabActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabFocused: {
    borderColor: colors.accent,
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 1,
  },
  tabLabelActive: {
    color: colors.textBright,
  },

  // Store
  storeMessage: {
    alignItems: "center",
    marginTop: 48,
    gap: 16,
  },
  storeError: {
    color: colors.danger,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 16,
  },
  cardDesc: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 6,
  },
  getButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: "transparent",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  removeButton: {
    backgroundColor: "transparent",
    borderColor: colors.danger,
  },
  removeButtonFocused: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.danger,
  },
  removeLabel: {
    color: colors.danger,
  },
  getButtonDisabled: {
    backgroundColor: colors.surfaceRaised,
  },
  getButtonFocused: {
    borderColor: colors.textBright,
  },
  getLabel: {
    color: colors.textBright,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 1,
  },
  getLabelDisabled: {
    color: colors.textMuted,
  },
  importButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 3,
    borderColor: "transparent",
    borderStyle: "dashed",
  },
  importButtonFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  importIcon: {
    color: colors.accent,
    fontSize: 36,
    fontWeight: "300",
    marginRight: 16,
  },
  importLabel: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: "500",
  },
});
