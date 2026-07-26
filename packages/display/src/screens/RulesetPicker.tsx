// ─── Ruleset Picker Screen (web) ───────────────────────────────────
// Web port of packages/host/src/screens/RulesetPicker.tsx. Shows the
// installed library (built-ins + imported rulesets) and a store tab that
// browses the published catalog. Selecting a game moves every connected
// client to the lobby via SELECT_RULESET.

import React, { useMemo, useState, useCallback } from "react";
import type {
  CardGameRuleset,
  CatalogGame,
  HostAction,
  HostGameState,
  InstalledGame,
} from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";
import { useRulesetStore } from "../host-logic/use-ruleset-store.js";
import { useCatalog, CATALOG_BASE_URL } from "../host-logic/use-catalog.js";
import {
  BUILT_IN_RULESETS,
  BUILT_IN_SLUGS,
} from "../host-logic/built-in-rulesets.js";
import { Button } from "../components/Button.js";
import { ImportModal } from "../components/ImportModal.js";
import { JoinPanel } from "../components/JoinPanel.js";
import { colors } from "../theme.js";

// ─── Types ─────────────────────────────────────────────────────────

interface RulesetItem {
  readonly id: string | null;
  readonly ruleset: CardGameRuleset;
  readonly source: "built_in" | "imported";
}

type Tab = "library" | "store";

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
  const {
    rulesets: storedRulesets,
    isLoading,
    importFromUrl,
    importWithSlug,
    allSlugs,
  } = useRulesetStore(BUILT_IN_SLUGS, state.installedSlugs);
  const [modalVisible, setModalVisible] = useState(false);
  const [tab, setTab] = useState<Tab>("library");

  const rulesetItems: readonly RulesetItem[] = useMemo(() => {
    const builtIn: RulesetItem[] = BUILT_IN_RULESETS.map((rs) => ({
      id: null,
      ruleset: rs,
      source: "built_in" as const,
    }));
    const imported: RulesetItem[] = storedRulesets.map((stored) => ({
      id: stored.id,
      ruleset: stored.ruleset,
      source: "imported" as const,
    }));
    return [...builtIn, ...imported];
  }, [storedRulesets]);

  const handleSelect = useCallback(
    (ruleset: CardGameRuleset) => {
      dispatch({ type: "SELECT_RULESET", ruleset });
    },
    [dispatch],
  );

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

      <TabBar tab={tab} onChange={setTab} />

      {tab === "store" ? (
        <StoreView
          installedSlugs={state.installedSlugs}
          builtInSlugs={BUILT_IN_SLUGS}
          dispatch={dispatch}
        />
      ) : isLoading ? (
        <div style={styles.loadingText}>Loading rulesets...</div>
      ) : (
        <div style={styles.listContent}>
          <div style={styles.grid}>
            {rulesetItems.map((item) => (
              <RulesetCard
                key={item.id ?? `builtin:${item.ruleset.meta.slug}`}
                item={item}
                onSelect={handleSelect}
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
          </div>
          <ImportPlaceholder onPress={() => setModalVisible(true)} />
        </div>
      )}

      <ImportModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onImport={importFromUrl}
        onImportWithSlug={importWithSlug}
        allSlugs={allSlugs}
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

  const playerRange =
    meta.players.min === meta.players.max
      ? `${meta.players.min} players`
      : `${meta.players.min}–${meta.players.max} players`;

  return (
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
      <div style={styles.cardMeta}>{playerRange}</div>
      <div style={styles.cardVersion}>v{meta.version}</div>
      {item.source === "built_in" && <div style={styles.badge}>BUILT-IN</div>}
      {onDelete != null && (
        // Stop propagation so removing a game doesn't also select it — the RN
        // original got this for free from nested Pressables.
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

function ImportPlaceholder({
  onPress,
}: {
  readonly onPress: () => void;
}): React.JSX.Element {
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

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: "library", label: "My Games" },
  { key: "store", label: "Store" },
];

function TabBar({
  tab,
  onChange,
}: {
  readonly tab: Tab;
  readonly onChange: (tab: Tab) => void;
}): React.JSX.Element {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  return (
    <div style={styles.tabBar}>
      {TABS.map((t) => {
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
      {catalog.games.length === 0 ? (
        <div style={styles.loadingText}>No games available yet</div>
      ) : (
        <div style={styles.grid}>
          {catalog.games.map((game) => {
            const installed = installedSlugs.find((s) => s.slug === game.slug);
            return (
              <StoreCard
                key={game.slug}
                game={game}
                installedVersion={installed?.version ?? null}
                installing={installing.has(game.slug)}
                isBuiltIn={builtInSlugs.includes(game.slug)}
                onInstall={() => void handleInstall(game)}
                onUninstall={() => handleUninstall(game)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Store Card ────────────────────────────────────────────────────

type StoreAction =
  | {
      readonly label: string;
      readonly variant: "primary" | "danger";
      readonly onPress: () => void;
    }
  | { readonly label: string; readonly variant: "disabled"; readonly onPress?: undefined };

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
    <div style={styles.card}>
      <div style={{ ...styles.cardName, ...ellipsis }}>{game.name}</div>
      <div style={{ ...styles.cardMeta, ...ellipsis }}>by {game.author}</div>
      <div style={styles.cardMeta}>{playerRange}</div>
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
