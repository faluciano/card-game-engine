// ─── Ruleset Picker Model ──────────────────────────────────────────
// Framework-free helpers for the "choose a game" screen shared by the
// TV host and the browser display: the library list (built-ins +
// imported), the store card actions, and the catalog install step.

import type { CardGameRuleset, CatalogGame, InstalledGame } from "@card-engine/shared";
import { safeParseRuleset } from "@card-engine/shared";
import type { StoredRuleset } from "./ruleset-store";
import { CATALOG_BASE_URL } from "./use-catalog";

// ─── Types ─────────────────────────────────────────────────────────

export interface RulesetItem {
  readonly id: string | null;
  readonly ruleset: CardGameRuleset;
  readonly source: "built_in" | "imported";
  /** Stable list key: the stored id, or `builtin:<slug>` for built-ins. */
  readonly key: string;
}

export type PickerTab = "library" | "store";

export const PICKER_TABS: readonly { readonly key: PickerTab; readonly label: string }[] = [
  { key: "library", label: "My Games" },
  { key: "store", label: "Store" },
];

export type StoreAction =
  | { readonly label: string; readonly variant: "primary" | "danger"; readonly onPress: () => void }
  | { readonly label: string; readonly variant: "disabled"; readonly onPress?: undefined };

// ─── Library ───────────────────────────────────────────────────────

/** Built-ins first, then imported rulesets, in store order. */
export function buildRulesetItems(
  builtIn: readonly CardGameRuleset[],
  stored: readonly StoredRuleset[],
): readonly RulesetItem[] {
  const builtInItems: RulesetItem[] = builtIn.map((ruleset) => ({
    id: null,
    ruleset,
    source: "built_in",
    key: `builtin:${ruleset.meta.slug}`,
  }));
  const importedItems: RulesetItem[] = stored.map((s) => ({
    id: s.id,
    ruleset: s.ruleset,
    source: "imported",
    key: s.id,
  }));
  return [...builtInItems, ...importedItems];
}

/** "2 players" or "2–6 players". */
export function formatPlayerRange(players: { readonly min: number; readonly max: number }): string {
  return players.min === players.max
    ? `${players.min} players`
    : `${players.min}–${players.max} players`;
}

// ─── Store ─────────────────────────────────────────────────────────

export interface StoreCardInput {
  readonly game: CatalogGame;
  readonly installedVersion: string | null;
  readonly installing: boolean;
  readonly isBuiltIn: boolean;
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}

/** The buttons a store card offers for a game in its current state. */
export function getStoreActions({
  game,
  installedVersion,
  installing,
  isBuiltIn,
  onInstall,
  onUninstall,
}: StoreCardInput): readonly StoreAction[] {
  if (installing) return [{ label: "...", variant: "disabled" }];

  const isInstalled = installedVersion !== null;
  if (!isInstalled) return [{ label: "GET", variant: "primary", onPress: onInstall }];

  const isUpdate = installedVersion !== game.version;
  return [
    ...(isUpdate ? [{ label: "UPDATE", variant: "primary", onPress: onInstall } as const] : []),
    ...(isBuiltIn
      ? isUpdate
        ? []
        : [{ label: "BUILT-IN", variant: "disabled" } as const]
      : [{ label: "REMOVE", variant: "danger", onPress: onUninstall } as const]),
  ];
}

/** Installed version of a catalog game, or null when not installed. */
export function findInstalledVersion(
  installedSlugs: readonly InstalledGame[],
  slug: string,
): string | null {
  return installedSlugs.find((s) => s.slug === slug)?.version ?? null;
}

/** Fetches and validates a catalog game's ruleset. Throws on any failure. */
export async function fetchCatalogRuleset(game: CatalogGame): Promise<CardGameRuleset> {
  const res = await fetch(`${CATALOG_BASE_URL}${game.file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const raw: unknown = await res.json();
  const result = safeParseRuleset(raw);
  if (!result.success) throw new Error("Invalid ruleset format");

  return result.data as CardGameRuleset;
}

/** Error banner shown when a store install fails. */
export function formatInstallError(game: CatalogGame, err: unknown): string {
  const message = err instanceof Error ? err.message : "Install failed";
  return `Could not install ${game.name}: ${message}`;
}
