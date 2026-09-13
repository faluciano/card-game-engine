// ─── Ruleset Picker Screen (web) ───────────────────────────────────
// Thin DOM renderer over `useRulesetPickerModel` / `useStoreViewModel`
// from host-core, mirroring packages/host/src/screens/RulesetPicker.tsx.
// Shows the installed library (built-ins + imported rulesets) and a
// store tab that browses the published catalog. Selecting a game moves
// every connected client to the lobby via SELECT_RULESET.

import React, { useState } from "react";
import type { CardGameRuleset, HostAction, HostGameState } from "@card-engine/shared";
import {
  PICKER_TABS,
  colors,
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
        <div style={styles.title}>CHOOSE A GAME</div>
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
              />
            ))}
          </div>
          <ImportPlaceholder onPress={model.openModal} />
        </div>
      )}

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

const RulesetCard = React.memo(function RulesetCard({
  item,
  onSelect,
  onDelete,
}: {
  readonly item: RulesetItem;
  readonly onSelect: (ruleset: CardGameRuleset) => void;
  readonly onDelete?: () => void;
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const { meta } = item.ruleset;

  return (
    // biome-ignore lint/a11y/useSemanticElements: cannot be a <button> because it nests the interactive DELETE <Button>; it is fully keyboard-operable (tabIndex + Enter/Space handler)
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.ruleset)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item.ruleset);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        ...styles.card,
        ...(hovered ? styles.cardFocused : null),
        cursor: "pointer",
        outline: "none",
      }}
    >
      <div style={{ ...styles.cardName, ...ellipsis }}>{meta.name}</div>
      <div style={{ ...styles.cardMeta, ...ellipsis }}>by {meta.author}</div>
      <div style={styles.cardMeta}>{formatPlayerRange(meta.players)}</div>
      <div style={styles.cardVersion}>v{meta.version}</div>
      {item.source === "built_in" && <div style={styles.badge}>BUILT-IN</div>}
      {onDelete != null && (
        // Stop propagation so removing a game doesn't also select it — the RN
        // original got this for free from nested Pressables.
        // biome-ignore lint/a11y/noStaticElementInteractions: non-interactive wrapper that only stops event propagation; the real control is the nested <Button>
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Button
            label="DELETE"
            variant="ghost"
            onPress={() => onDelete()}
            style={styles.deleteButton}
            labelStyle={styles.deleteLabel}
          />
        </span>
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

function TabBar({
  tab,
  onChange,
}: {
  readonly tab: PickerTab;
  readonly onChange: (tab: PickerTab) => void;
}): React.JSX.Element {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div style={styles.tabBar}>
      {PICKER_TABS.map((t) => {
        const active = tab === t.key;
        const hovered = hoveredKey === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
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

// ─── Styles ────────────────────────────────────────────────────────

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const styles = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.bg,
    padding: "28px 48px 0",
    minHeight: 0,
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: {
    color: colors.textBright,
    fontSize: 38,
    fontWeight: 800,
    letterSpacing: 2,
  },
  qrSection: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qrHint: {
    color: colors.textDim,
    fontSize: 18,
    lineHeight: 1.45,
  },
  listContent: {
    flex: 1,
    overflowY: "auto",
    paddingBottom: 48,
    minHeight: 0,
  },
  grid: {
    display: "flex",
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
    borderStyle: "solid",
    borderColor: "transparent",
    boxSizing: "border-box",
    minWidth: 0,
  },
  cardFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  cardName: {
    color: colors.textBright,
    fontSize: 26,
    fontWeight: 700,
    marginBottom: 4,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 17,
    lineHeight: 1.35,
  },
  cardVersion: {
    color: colors.textFaint,
    fontSize: 14,
    marginTop: 6,
  },
  cardDesc: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 1.35,
    marginTop: 6,
  },
  badge: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: 700,
    marginTop: 12,
    letterSpacing: 1,
  },
  deleteButton: {
    marginTop: 12,
    padding: "6px 12px",
    borderRadius: 8,
    borderWidth: 2,
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: 700,
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
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  tab: {
    padding: "10px 26px",
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    cursor: "pointer",
    font: "inherit",
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
    fontWeight: 700,
    letterSpacing: 1,
  },
  tabLabelActive: {
    color: colors.textBright,
  },

  // Store
  storeMessage: {
    display: "flex",
    flexDirection: "column",
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
  actionsRow: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  pillButton: {
    padding: "8px 26px",
    borderRadius: 999,
  },
  pillLabel: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: 1,
  },
  importButton: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    marginTop: 8,
    borderWidth: 3,
    borderStyle: "dashed",
    borderColor: "transparent",
    cursor: "pointer",
    boxSizing: "border-box",
  },
  importButtonFocused: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  importIcon: {
    color: colors.accent,
    fontSize: 36,
    fontWeight: 300,
    marginRight: 16,
  },
  importLabel: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: 500,
  },
} satisfies Record<string, React.CSSProperties>;
