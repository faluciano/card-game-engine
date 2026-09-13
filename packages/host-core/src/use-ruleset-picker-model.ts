// ─── Ruleset Picker Hooks ──────────────────────────────────────────
// Stateful glue for the "choose a game" screen: the library tab (stored
// rulesets + import modal) and the store tab (catalog browse/install).
// Both the TV host and the web display render these models; only the
// QR / join panel and the widgets differ.

import { useCallback, useMemo, useState } from "react";
import type { CardGameRuleset, CatalogGame, HostAction, HostGameState } from "@card-engine/shared";
import { BUILT_IN_RULESETS, BUILT_IN_SLUGS } from "./built-in-rulesets";
import {
  buildRulesetItems,
  fetchCatalogRuleset,
  findInstalledVersion,
  formatInstallError,
  type PickerTab,
  type RulesetItem,
} from "./ruleset-picker-model";
import type { RulesetStore } from "./ruleset-store";
import { useCatalog, type CatalogState } from "./use-catalog";
import { useRulesetStore, type ImportResult } from "./use-ruleset-store";

// ─── Library ───────────────────────────────────────────────────────

export interface RulesetPickerModel {
  readonly tab: PickerTab;
  readonly setTab: (tab: PickerTab) => void;
  readonly isLoading: boolean;
  readonly rulesetItems: readonly RulesetItem[];
  readonly selectRuleset: (ruleset: CardGameRuleset) => void;
  /** Delete handler for imported items; undefined for built-ins. */
  readonly deleteHandlerFor: (item: RulesetItem) => (() => void) | undefined;
  readonly modalVisible: boolean;
  readonly openModal: () => void;
  readonly closeModal: () => void;
  readonly importFromUrl: (url: string) => Promise<ImportResult>;
  readonly importWithSlug: (url: string, slug: string) => Promise<ImportResult>;
  readonly allSlugs: readonly string[];
  readonly builtInSlugs: readonly string[];
}

/**
 * Screen-level model for the picker. `store` must be a stable
 * (module-level) instance, as required by useRulesetStore.
 */
export function useRulesetPickerModel(
  state: HostGameState,
  dispatch: (action: HostAction) => void,
  store: RulesetStore,
): RulesetPickerModel {
  const {
    rulesets: storedRulesets,
    isLoading,
    importFromUrl,
    importWithSlug,
    allSlugs,
  } = useRulesetStore(store, BUILT_IN_SLUGS, state.installedSlugs);
  const [modalVisible, setModalVisible] = useState(false);
  const [tab, setTab] = useState<PickerTab>("library");

  const rulesetItems = useMemo(
    () => buildRulesetItems(BUILT_IN_RULESETS, storedRulesets),
    [storedRulesets],
  );

  const selectRuleset = useCallback(
    (ruleset: CardGameRuleset) => {
      dispatch({ type: "SELECT_RULESET", ruleset });
    },
    [dispatch],
  );

  const deleteHandlerFor = useCallback(
    (item: RulesetItem) =>
      item.source === "imported" && item.id != null
        ? () => dispatch({ type: "UNINSTALL_RULESET", slug: item.ruleset.meta.slug })
        : undefined,
    [dispatch],
  );

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  return {
    tab,
    setTab,
    isLoading,
    rulesetItems,
    selectRuleset,
    deleteHandlerFor,
    modalVisible,
    openModal,
    closeModal,
    importFromUrl,
    importWithSlug,
    allSlugs,
    builtInSlugs: BUILT_IN_SLUGS,
  };
}

// ─── Store ─────────────────────────────────────────────────────────

export interface StoreGameModel {
  readonly game: CatalogGame;
  readonly installedVersion: string | null;
  readonly installing: boolean;
  readonly isBuiltIn: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}

export interface StoreViewModel {
  readonly catalog: CatalogState;
  readonly refetch: () => void;
  /** Last install failure, cleared on the next install/uninstall attempt. */
  readonly error: string | null;
  /** One entry per catalog game (empty unless the catalog is loaded). */
  readonly games: readonly StoreGameModel[];
}

/**
 * Store tab: fetches the catalog and tracks in-flight installs.
 * Installing fetches + validates the ruleset here, then hands it to the
 * host reducer via INSTALL_RULESET so the platform store persists it.
 */
export function useStoreViewModel(
  installedSlugs: HostGameState["installedSlugs"],
  builtInSlugs: readonly string[],
  dispatch: (action: HostAction) => void,
): StoreViewModel {
  const { catalog, refetch } = useCatalog();
  const [installing, setInstalling] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(
    async (game: CatalogGame): Promise<void> => {
      setError(null);
      setInstalling((prev) => new Set(prev).add(game.slug));
      try {
        const ruleset = await fetchCatalogRuleset(game);
        dispatch({ type: "INSTALL_RULESET", ruleset, slug: game.slug });
      } catch (err) {
        setError(formatInstallError(game, err));
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

  const uninstall = useCallback(
    (game: CatalogGame): void => {
      setError(null);
      dispatch({ type: "UNINSTALL_RULESET", slug: game.slug });
    },
    [dispatch],
  );

  const games = useMemo((): readonly StoreGameModel[] => {
    if (catalog.tag !== "loaded") return [];
    return catalog.games.map((game) => ({
      game,
      installedVersion: findInstalledVersion(installedSlugs, game.slug),
      installing: installing.has(game.slug),
      isBuiltIn: builtInSlugs.includes(game.slug),
      onInstall: () => void install(game),
      onUninstall: () => uninstall(game),
    }));
  }, [catalog, installedSlugs, installing, builtInSlugs, install, uninstall]);

  return { catalog, refetch, error, games };
}
