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
import { TVPressable } from "../components/TVPressable";
import { rulesetStore } from "../storage";
import { styles } from "./RulesetPicker.styles";

// ─── Component ─────────────────────────────────────────────────────

export function RulesetPicker(): React.JSX.Element {
  const { state, dispatch, serverUrl } = useGameHost<HostGameState, HostAction>();
  const model = useRulesetPickerModel(state, dispatch, rulesetStore);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          CHOOSE A GAME
        </Text>
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

/**
 * One library entry. The selectable body and the DELETE control are
 * sibling focusables inside a plain View shell: nesting a Pressable in a
 * Pressable makes D-pad focus order ambiguous and TalkBack announce the
 * delete label as part of the card. The shell carries the focus ring so
 * the whole card still lights up when its body is focused.
 */
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
  const [bodyFocused, setBodyFocused] = useState(false);
  const { meta } = item.ruleset;
  const sourceLabel = item.source === "built_in" ? "built-in" : "imported";

  return (
    <View style={[styles.card, bodyFocused && styles.cardFocused]}>
      <Pressable
        style={styles.cardBody}
        onFocus={() => setBodyFocused(true)}
        onBlur={() => setBodyFocused(false)}
        onPress={() => onSelect(item.ruleset)}
        hasTVPreferredFocus={isFirst}
        accessibilityRole="button"
        accessibilityLabel={`Play ${meta.name}, ${sourceLabel}, ${formatPlayerRange(meta.players)}`}
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
      </Pressable>
      {onDelete != null && (
        <TVPressable
          style={styles.deleteButton}
          focusedStyle={styles.deleteButtonFocused}
          onPress={onDelete}
          accessibilityLabel={`Delete ${meta.name}`}
        >
          <Text style={styles.deleteLabel}>DELETE</Text>
        </TVPressable>
      )}
    </View>
  );
});

// ─── Import Placeholder ────────────────────────────────────────────

function ImportPlaceholder({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  return (
    <TVPressable
      style={styles.importButton}
      focusedStyle={styles.importButtonFocused}
      onPress={onPress}
      accessibilityLabel="Import a ruleset from a URL"
    >
      <Text style={styles.importIcon}>+</Text>
      <Text style={styles.importLabel}>Import Ruleset</Text>
    </TVPressable>
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
  return (
    <View style={styles.tabBar} accessibilityRole="tablist">
      {PICKER_TABS.map((t) => {
        const active = tab === t.key;
        return (
          <TVPressable
            key={t.key}
            style={[styles.tab, active && styles.tabActive]}
            focusedStyle={styles.tabFocused}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${t.label} tab`}
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </TVPressable>
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
          <ActionButton key={action.label} action={action} gameName={game.name} />
        ))}
      </View>
    </View>
  );
});

// ─── Store Action Button ───────────────────────────────────────────

function ActionButton({
  action,
  gameName,
}: {
  readonly action: StoreAction;
  readonly gameName: string;
}): React.JSX.Element {
  const isDisabled = action.variant === "disabled";
  const isDanger = action.variant === "danger";

  return (
    <TVPressable
      style={[styles.getButton, isDanger && styles.removeButton]}
      focusedStyle={isDanger ? styles.removeButtonFocused : styles.getButtonFocused}
      disabledStyle={styles.getButtonDisabled}
      onPress={action.onPress}
      disabled={isDisabled}
      accessibilityLabel={`${action.label} ${gameName}`}
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
    </TVPressable>
  );
}

// ─── Retry Button ──────────────────────────────────────────────────

function RetryButton({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  return (
    <TVPressable
      style={styles.getButton}
      focusedStyle={styles.getButtonFocused}
      onPress={onPress}
      hasTVPreferredFocus
      accessibilityLabel="Retry loading the store"
    >
      <Text style={styles.getLabel}>RETRY</Text>
    </TVPressable>
  );
}
