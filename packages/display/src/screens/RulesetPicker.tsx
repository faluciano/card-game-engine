// ─── Ruleset Picker Screen (web) ───────────────────────────────────
// Thin DOM renderer over `useRulesetPickerModel` / `useStoreViewModel`
// from host-core, mirroring packages/host/src/screens/RulesetPicker.tsx.
// Shows the installed library (built-ins + imported rulesets) and a
// store tab that browses the published catalog. Selecting a game moves
// every connected client to the lobby via SELECT_RULESET.

import React, { useRef, useState } from "react";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";
import {
  PICKER_TABS,
  formatPlayerRange,
  getStoreActions,
  useRulesetPickerModel,
  useStoreViewModel,
  type PickerTab,
  type RulesetItem,
  type StoreGameModel,
} from "@card-engine/host-core";
import { Button } from "../components/Button.js";
import { ImportModal } from "../components/ImportModal.js";
import { JoinPanel } from "../components/JoinPanel.js";
import { rulesetStore } from "../storage/web-ruleset-store.js";
import { clamp2, ellipsis, styles } from "./RulesetPicker.styles.js";

const TAB_ID_PREFIX = "picker-tab-";
const TAB_PANEL_ID = "picker-tabpanel";

// ─── Component ─────────────────────────────────────────────────────

export function RulesetPicker({
  state,
  dispatch,
  joinUrl,
  roomId,
}: {
  readonly state: HostGameState;
  readonly dispatch: (action: HostAction) => void;
  readonly joinUrl: string | null;
  readonly roomId: string | null;
}): React.JSX.Element {
  const model = useRulesetPickerModel(state, dispatch, rulesetStore);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>CHOOSE A GAME</h1>
        <div style={styles.qrSection}>
          <JoinPanel joinUrl={joinUrl} roomId={roomId} size={120} />
          <div style={styles.qrHint}>
            Scan to connect
            <br />
            your phone
          </div>
        </div>
      </div>

      <TabBar tab={model.tab} onChange={model.setTab} />

      <div
        id={TAB_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`${TAB_ID_PREFIX}${model.tab}`}
        style={styles.tabPanel}
      >
        {model.tab === "store" ? (
          <StoreView
            installedSlugs={state.installedSlugs}
            builtInSlugs={model.builtInSlugs}
            dispatch={dispatch}
          />
        ) : model.isLoading ? (
          <div style={styles.loadingText}>Loading rulesets...</div>
        ) : (
          <div style={styles.listContent}>
            <div style={styles.grid}>
              {model.rulesetItems.map((item) => (
                <RulesetCard
                  key={item.key}
                  item={item}
                  onSelect={model.selectRuleset}
                  onDelete={model.deleteHandlerFor(item)}
                  deleteLabel={model.deleteLabelFor(item)}
                  isConfirmingDelete={model.confirmingDeleteKey === item.key}
                  onCancelDelete={model.cancelDelete}
                />
              ))}
            </div>
            <ImportPlaceholder onPress={model.openModal} />
          </div>
        )}
      </div>

      <ImportModal
        visible={model.modalVisible}
        onClose={model.closeModal}
        onImport={model.importFromUrl}
        onImportWithSlug={model.importWithSlug}
        allSlugs={model.allSlugs}
      />
    </div>
  );
}

// ─── Ruleset Card ──────────────────────────────────────────────────

/**
 * One library entry. The selectable body is a real <button> and DELETE
 * is its sibling, so neither control is nested in the other and no
 * propagation tricks are needed. The shell highlights while the body
 * is hovered or focused.
 */
const RulesetCard = React.memo(function RulesetCard({
  item,
  onSelect,
  onDelete,
  deleteLabel,
  isConfirmingDelete,
  onCancelDelete,
}: {
  readonly item: RulesetItem;
  readonly onSelect: (ruleset: CardGameRuleset) => void;
  readonly onDelete?: () => void;
  readonly deleteLabel: string;
  readonly isConfirmingDelete: boolean;
  readonly onCancelDelete: (item: RulesetItem) => void;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const { meta } = item.ruleset;
  const highlighted = hovered || bodyFocused;

  return (
    <div style={{ ...styles.card, ...(highlighted ? styles.cardFocused : null) }}>
      <button
        type="button"
        onClick={() => onSelect(item.ruleset)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setBodyFocused(true)}
        onBlur={() => setBodyFocused(false)}
        style={styles.cardBody}
      >
        <div style={{ ...styles.cardName, ...ellipsis }}>{meta.name}</div>
        <div style={{ ...styles.cardMeta, ...ellipsis }}>by {meta.author}</div>
        <div style={styles.cardMeta}>{formatPlayerRange(meta.players)}</div>
        <div style={styles.cardVersion}>v{meta.version}</div>
        {item.source === "built_in" && <div style={styles.badge}>BUILT-IN</div>}
      </button>
      {onDelete != null && (
        <Button
          label={deleteLabel}
          variant={isConfirmingDelete ? "danger" : "ghost"}
          onPress={onDelete}
          onBlur={() => onCancelDelete(item)}
          ariaLabel={
            isConfirmingDelete ? `Press again to delete ${meta.name}` : `Delete ${meta.name}`
          }
          style={styles.deleteButton}
          labelStyle={styles.deleteLabel}
        />
      )}
    </div>
  );
});

// ─── Import Placeholder ────────────────────────────────────────────

function ImportPlaceholder({ onPress }: { readonly onPress: () => void }): React.JSX.Element {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-haspopup="dialog"
      style={{
        ...styles.importButton,
        ...(hovered ? styles.importButtonFocused : null),
      }}
    >
      <span style={styles.importIcon}>+</span>
      <span style={styles.importLabel}>Import Ruleset</span>
    </button>
  );
}

// ─── Tab Bar ───────────────────────────────────────────────────────

/**
 * WAI-ARIA tabs with automatic activation: only the active tab is in
 * the Tab order (roving tabindex); Left/Right wrap between tabs and
 * Home/End jump to the ends, selecting the tab as focus lands on it.
 */
function TabBar({
  tab,
  onChange,
}: {
  readonly tab: PickerTab;
  readonly onChange: (tab: PickerTab) => void;
}): React.JSX.Element {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const tabRefs = useRef(new Map<PickerTab, HTMLButtonElement>());

  const moveTo = (index: number): void => {
    const count = PICKER_TABS.length;
    const next = PICKER_TABS[((index % count) + count) % count];
    if (next === undefined) return;
    onChange(next.key);
    tabRefs.current.get(next.key)?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number): void => {
    switch (e.key) {
      case "ArrowRight":
        moveTo(index + 1);
        break;
      case "ArrowLeft":
        moveTo(index - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(PICKER_TABS.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div role="tablist" aria-label="Game source" style={styles.tabBar}>
      {PICKER_TABS.map((t, index) => {
        const active = tab === t.key;
        const hovered = hoveredKey === t.key;
        return (
          <button
            key={t.key}
            ref={(el) => {
              if (el) tabRefs.current.set(t.key, el);
              else tabRefs.current.delete(t.key);
            }}
            id={`${TAB_ID_PREFIX}${t.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={TAB_PANEL_ID}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onMouseEnter={() => setHoveredKey(t.key)}
            onMouseLeave={() => setHoveredKey(null)}
            onFocus={() => setHoveredKey(t.key)}
            onBlur={() => setHoveredKey(null)}
            style={{
              ...styles.tab,
              ...(active ? styles.tabActive : null),
              ...(hovered ? styles.tabFocused : null),
            }}
          >
            <span
              style={{
                ...styles.tabLabel,
                ...(active ? styles.tabLabelActive : null),
              }}
            >
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
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
    return <div style={styles.loadingText}>Loading store...</div>;
  }

  if (catalog.tag === "error") {
    return (
      <div style={styles.storeMessage}>
        <div style={styles.loadingText}>Couldn&apos;t load the store</div>
        <div style={styles.storeError}>{catalog.message}</div>
        <Button label="RETRY" variant="primary" onPress={refetch} />
      </div>
    );
  }

  return (
    <div style={styles.listContent}>
      {error != null && <div style={styles.storeError}>{error}</div>}
      {games.length === 0 ? (
        <div style={styles.loadingText}>No games available yet</div>
      ) : (
        <div style={styles.grid}>
          {games.map((entry) => (
            <StoreCard key={entry.game.slug} entry={entry} />
          ))}
        </div>
      )}
    </div>
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
    <div style={styles.card}>
      <div style={{ ...styles.cardName, ...ellipsis }}>{game.name}</div>
      <div style={{ ...styles.cardMeta, ...ellipsis }}>by {game.author}</div>
      <div style={styles.cardMeta}>{formatPlayerRange(game.players)}</div>
      {game.description != null && game.description !== "" && (
        <div style={{ ...styles.cardDesc, ...clamp2 }}>{game.description}</div>
      )}
      <div style={styles.cardVersion}>v{game.version}</div>
      <div style={styles.actionsRow}>
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            variant={action.variant === "disabled" ? "secondary" : action.variant}
            disabled={action.variant === "disabled"}
            onPress={action.onPress}
            style={styles.pillButton}
            labelStyle={styles.pillLabel}
          />
        ))}
      </div>
    </div>
  );
});
