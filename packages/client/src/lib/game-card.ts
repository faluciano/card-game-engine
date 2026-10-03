// ─── Game Card Model ───────────────────────────────────────────────
// Decides which buttons a catalog card shows. The install / update /
// remove decision is delegated to host-core's `getStoreActions` so the
// phone agrees with the TV (built-ins never offer "Remove"); the lobby's
// Select / Selected states layer on top.

import type { CatalogGame } from "@card-engine/shared";
import { getStoreActions } from "@card-engine/host-core/catalog";

export type GameCardPrimary =
  | { readonly kind: "get"; readonly label: "Get" }
  | { readonly kind: "update"; readonly label: "Update" }
  | { readonly kind: "select"; readonly label: "Select" }
  | { readonly kind: "selected"; readonly label: "Selected ✓" }
  | { readonly kind: "installed"; readonly label: "Installed ✓" }
  | { readonly kind: "installing"; readonly label: "Installing…" }
  | { readonly kind: "removing"; readonly label: "Removing…" };

export interface GameCardModel {
  readonly primary: GameCardPrimary;
  /** Secondary "Remove" link under the primary button. */
  readonly showRemove: boolean;
}

export interface GameCardInput {
  readonly game: CatalogGame;
  /** Installed version on the host, or null when not installed. */
  readonly installedVersion: string | null;
  readonly isBuiltIn: boolean;
  readonly isPending: boolean;
  readonly isUninstalling: boolean;
  readonly isSelected: boolean;
  /** Whether the card is in a context where a game can be selected (lobby). */
  readonly canSelect: boolean;
  readonly canUninstall: boolean;
}

const NOOP = (): void => {};

export function getGameCardModel(input: GameCardInput): GameCardModel {
  if (input.isUninstalling) {
    return { primary: { kind: "removing", label: "Removing…" }, showRemove: false };
  }
  if (input.isPending) {
    return { primary: { kind: "installing", label: "Installing…" }, showRemove: false };
  }

  const storeActions = getStoreActions({
    game: input.game,
    installedVersion: input.installedVersion,
    installing: false,
    isBuiltIn: input.isBuiltIn,
    onInstall: NOOP,
    onUninstall: NOOP,
  });
  const showRemove = input.canUninstall && storeActions.some((a) => a.variant === "danger");

  if (storeActions.some((a) => a.label === "UPDATE")) {
    return { primary: { kind: "update", label: "Update" }, showRemove };
  }

  // The chosen lobby game reads as selected even if it is missing from
  // installedSlugs (e.g. a built-in the host has not reported yet).
  if (input.isSelected) {
    return { primary: { kind: "selected", label: "Selected ✓" }, showRemove: false };
  }

  if (input.installedVersion === null) {
    return { primary: { kind: "get", label: "Get" }, showRemove: false };
  }

  if (input.canSelect) {
    return { primary: { kind: "select", label: "Select" }, showRemove };
  }

  return { primary: { kind: "installed", label: "Installed ✓" }, showRemove };
}
