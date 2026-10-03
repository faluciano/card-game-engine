// ─── Ruleset Picker Hooks ──────────────────────────────────────────
// Stateful glue for the "choose a game" screen: the library tab (stored
// rulesets + import modal) and the store tab (catalog browse/install).
// Both the TV host and the web display render these models; only the
// QR / join panel and the widgets differ.

import { useCallback, useEffect, useMemo, useState } from "react";
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

// ─── Delete Confirmation ───────────────────────────────────────────
// Deleting an imported ruleset has no undo, so it takes two presses on
// the same card: the first arms it ("PRESS AGAIN TO DELETE"), the second
// commits. Arming expires after DELETE_CONFIRM_TIMEOUT_MS and is dropped
// whenever the user does anything else (selects a game, switches tab,
// opens the import modal, moves focus off the control, arms another card).

/** How long an armed delete stays armed before reverting. */
export const DELETE_CONFIRM_TIMEOUT_MS = 4000;

export const DELETE_LABEL = "DELETE";
export const DELETE_CONFIRM_LABEL = "PRESS AGAIN TO DELETE";

export interface DeletePressResult {
  /** Key of the card left armed after this press (null = none). */
  readonly confirmingKey: string | null;
  /** True when this press should actually delete the ruleset. */
  readonly shouldDelete: boolean;
}

/**
 * Pure transition for a press on `key`'s delete control: arms an idle
 * (or differently armed) card, commits an already armed one.
 */
export function pressDelete(confirmingKey: string | null, key: string): DeletePressResult {
  if (confirmingKey === key) return { confirmingKey: null, shouldDelete: true };
  return { confirmingKey: key, shouldDelete: false };
}

/**
 * Pure transition for a cancel. With a `key`, only disarms that card
 * (a blur on one card must not disarm another); without, disarms any.
 */
export function cancelDeleteConfirm(confirmingKey: string | null, key?: string): string | null {
  if (key !== undefined && confirmingKey !== key) return confirmingKey;
  return null;
}

/** Label for an item's delete control given the armed key. */
export function deleteLabel(confirmingKey: string | null, key: string): string {
  return confirmingKey === key ? DELETE_CONFIRM_LABEL : DELETE_LABEL;
}

// ─── Library ───────────────────────────────────────────────────────

export interface RulesetPickerModel {
  readonly tab: PickerTab;
  readonly setTab: (tab: PickerTab) => void;
  readonly isLoading: boolean;
  readonly rulesetItems: readonly RulesetItem[];
  readonly selectRuleset: (ruleset: CardGameRuleset) => void;
  /**
   * Two-step delete handler for imported items (first call arms, second
   * call on the same item deletes); undefined for built-ins.
   */
  readonly deleteHandlerFor: (item: RulesetItem) => (() => void) | undefined;
  /** `item.key` of the card awaiting a confirming press, if any. */
  readonly confirmingDeleteKey: string | null;
  /** "DELETE" or "PRESS AGAIN TO DELETE" for the item's delete control. */
  readonly deleteLabelFor: (item: RulesetItem) => string;
  /** Disarm a pending delete (only `item`'s, when given). Call on blur. */
  readonly cancelDelete: (item?: RulesetItem) => void;
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
  const [tab, setTabState] = useState<PickerTab>("library");
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);

  // Auto-cancel an armed delete after a few seconds of inaction.
  useEffect(() => {
    if (confirmingDeleteKey === null) return;
    const timer = setTimeout(() => setConfirmingDeleteKey(null), DELETE_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirmingDeleteKey]);

  const rulesetItems = useMemo(
    () => buildRulesetItems(BUILT_IN_RULESETS, storedRulesets),
    [storedRulesets],
  );

  const selectRuleset = useCallback(
    (ruleset: CardGameRuleset) => {
      setConfirmingDeleteKey(null);
      dispatch({ type: "SELECT_RULESET", ruleset });
    },
    [dispatch],
  );

  const setTab = useCallback((next: PickerTab) => {
    setConfirmingDeleteKey(null);
    setTabState(next);
  }, []);

  const deleteHandlerFor = useCallback(
    (item: RulesetItem) => {
      if (item.source !== "imported" || item.id == null) return undefined;
      const slug = item.ruleset.meta.slug;
      return () => {
        const { confirmingKey, shouldDelete } = pressDelete(confirmingDeleteKey, item.key);
        setConfirmingDeleteKey(confirmingKey);
        if (shouldDelete) dispatch({ type: "UNINSTALL_RULESET", slug });
      };
    },
    [dispatch, confirmingDeleteKey],
  );

  const deleteLabelFor = useCallback(
    (item: RulesetItem) => deleteLabel(confirmingDeleteKey, item.key),
    [confirmingDeleteKey],
  );

  const cancelDelete = useCallback((item?: RulesetItem) => {
    setConfirmingDeleteKey((prev) => cancelDeleteConfirm(prev, item?.key));
  }, []);

  const openModal = useCallback(() => {
    setConfirmingDeleteKey(null);
    setModalVisible(true);
  }, []);
  const closeModal = useCallback(() => setModalVisible(false), []);

  return {
    tab,
    setTab,
    isLoading,
    rulesetItems,
    selectRuleset,
    deleteHandlerFor,
    confirmingDeleteKey,
    deleteLabelFor,
    cancelDelete,
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
