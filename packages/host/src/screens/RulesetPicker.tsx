// ─── Ruleset Picker Screen ─────────────────────────────────────────
// Displays available rulesets and allows the user to select one. A
// thin RN renderer over `useRulesetPickerModel` / `useStoreViewModel`
// from host-core; built-in rulesets are loaded at build time and
// user-imported rulesets are persisted via FileRulesetStore.

import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useGameHost } from "@couch-kit/host";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";
import {
  PICKER_TABS,
  formatPlayerRange,
  getStoreActions,
  useRulesetPickerModel,
  useStoreViewModel,
  type PickerTab,
  type RulesetItem,
  type StoreAction,
  type StoreGameModel,
} from "@card-engine/host-core";
import { ImportModal } from "../components/ImportModal";
import { QRDisplay } from "../components/QRDisplay";
import { rulesetStore } from "../storage";
import { styles } from "./RulesetPicker.styles";

// ─── Component ─────────────────────────────────────────────────────

export function RulesetPicker(): React.JSX.Element {
  const { state, dispatch, serverUrl } = useGameHost<HostGameState, HostAction>();
  const model = useRulesetPickerModel(state, dispatch, rulesetStore);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CHOOSE A GAME</Text>
        <View style={styles.qrSection}>
          <QRDisplay url={serverUrl} size={100} />
          <Text style={styles.qrHint}>Scan to connect{"\n"}your phone</Text>
        </View>
      </View>

      <TabBar tab={model.tab} onChange={model.setTab} />

      {model.tab === "store" ? (
        <StoreView
          installedSlugs={state.installedSlugs}
          builtInSlugs={model.builtInSlugs}
          dispatch={dispatch}
        />
      ) : model.isLoading ? (
        <Text style={styles.loadingText}>Loading rulesets...</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          <View style={styles.grid}>
            {model.rulesetItems.map((item, index) => (
              <RulesetCard
                key={item.key}
                item={item}
                onSelect={model.selectRuleset}
                isFirst={index === 0}
                onDelete={model.deleteHandlerFor(item)}
              />
            ))}
          </View>
          <ImportPlaceholder onPress={model.openModal} />
        </ScrollView>
      )}

      <ImportModal
        visible={model.modalVisible}
        onClose={model.closeModal}
        onImport={model.importFromUrl}
        onImportWithSlug={model.importWithSlug}
        allSlugs={model.allSlugs}
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

  return (
    <Pressable
      style={[styles.card, focused && styles.cardFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item.ruleset)}
      hasTVPreferredFocus={isFirst}
    >
      <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
        {meta.name}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1} ellipsizeMode="tail">
        by {meta.author}
      </Text>
      <Text style={styles.cardMeta}>{formatPlayerRange(meta.players)}</Text>
      <Text style={styles.cardVersion}>v{meta.version}</Text>
      {item.source === "built_in" && <Text style={styles.badge}>BUILT-IN</Text>}
      {onDelete != null && (
        <Pressable
          style={[styles.deleteButton, deleteFocused && styles.deleteButtonFocused]}
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

function ImportPlaceholder({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
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

function TabBar({
  tab,
  onChange,
}: {
  readonly tab: PickerTab;
  readonly onChange: (tab: PickerTab) => void;
}): React.JSX.Element {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  return (
    <View style={styles.tabBar}>
      {PICKER_TABS.map((t) => {
        const active = tab === t.key;
        const focused = focusedKey === t.key;
        return (
          <Pressable
            key={t.key}
            style={[styles.tab, active && styles.tabActive, focused && styles.tabFocused]}
            onFocus={() => setFocusedKey(t.key)}
            onBlur={() => setFocusedKey(null)}
            onPress={() => onChange(t.key)}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
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
  readonly installedSlugs: HostGameState["installedSlugs"];
  readonly builtInSlugs: readonly string[];
  readonly dispatch: (action: HostAction) => void;
}): React.JSX.Element {
  const { catalog, refetch, error, games } = useStoreViewModel(
    installedSlugs,
    builtInSlugs,
    dispatch,
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
      {games.length === 0 ? (
        <Text style={styles.loadingText}>No games available yet</Text>
      ) : (
        <View style={styles.grid}>
          {games.map((entry) => (
            <StoreCard key={entry.game.slug} entry={entry} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Store Card ────────────────────────────────────────────────────

const StoreCard = React.memo(function StoreCard({
  entry,
}: {
  readonly entry: StoreGameModel;
}): React.JSX.Element {
  const { game } = entry;
  const actions = getStoreActions(entry);

  return (
    <View style={styles.card}>
      <Text style={styles.cardName} numberOfLines={1} ellipsizeMode="tail">
        {game.name}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1} ellipsizeMode="tail">
        by {game.author}
      </Text>
      <Text style={styles.cardMeta}>{formatPlayerRange(game.players)}</Text>
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

function RetryButton({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
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
