// ─── Host Bridge State ─────────────────────────────────────────────
// Reconciles the card engine's CardGameState (array-based players,
// discriminated-union status) with CouchKit's IGameState (Record-based
// players, string status). This is the single source of truth for the
// host app's navigation and game lifecycle.

import type { IGameState, IPlayer } from "@couch-kit/core";
import type {
  CardGameAction,
  CardGameRuleset,
  CardGameState,
} from "../types/index";

// ─── Installed Game ────────────────────────────────────────────────

/** A slug + version pair for a locally installed ruleset. */
export interface InstalledGame {
  readonly slug: string;
  readonly version: string;
}

// ─── Catalog ───────────────────────────────────────────────────────

/**
 * A single game entry from the `catalog.json` served by GitHub Pages.
 * Describes a published ruleset available for installation on the host TV.
 */
export interface CatalogGame {
  readonly name: string;
  readonly slug: string;
  readonly version: string;
  readonly author: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly license?: string;
  readonly players: { readonly min: number; readonly max: number };
  /** Relative path inside the catalog archive, e.g. "rulesets/blackjack.cardgame.json". */
  readonly file: string;
}

// ─── Screen Navigation ─────────────────────────────────────────────

/**
 * Screen-level navigation for the host app.
 * Discriminated on `tag` for exhaustive switch coverage.
 */
export type HostScreen =
  | { readonly tag: "ruleset_picker" }
  | {
      readonly tag: "lobby";
      readonly ruleset: CardGameRuleset;
    }
  | {
      readonly tag: "game_table";
      readonly ruleset: CardGameRuleset;
    };

// ─── Host Game State ───────────────────────────────────────────────

/**
 * The canonical state for the CouchKit host provider.
 * Extends IGameState for CouchKit compatibility while wrapping the
 * card engine state.
 */
export interface HostGameState extends IGameState {
  /** CouchKit-required string status — derived from current screen/engine state. */
  readonly status: string;
  /** CouchKit-managed player record. */
  readonly players: Record<string, IPlayer>;
  /** Current screen navigation state. */
  readonly screen: HostScreen;
  /** Card engine state — null until game starts. */
  readonly engineState: CardGameState | null;
  /** Rulesets currently installed on the host TV (slug + version). */
  readonly installedSlugs: readonly InstalledGame[];
  /** Transient: set by reducer when client requests install, cleared by host hook after I/O. */
  readonly pendingInstall: { readonly ruleset: CardGameRuleset; readonly slug: string } | null;
  /** Transient: set by reducer when client requests uninstall, cleared by host hook after I/O. */
  readonly pendingUninstall: string | null;
}

// ─── Host Actions ──────────────────────────────────────────────────

/**
 * All host-level actions as a discriminated union.
 * Uses `type` (not `kind`) because CouchKit's IAction requires `type: string`.
 */
export type HostAction =
  | { readonly type: "SELECT_RULESET"; readonly ruleset: CardGameRuleset }
  | { readonly type: "BACK_TO_PICKER" }
  | { readonly type: "START_GAME"; readonly seed?: number }
  | { readonly type: "GAME_ACTION"; readonly action: CardGameAction }
  | { readonly type: "RESET_ROUND" }
  | { readonly type: "ADVANCE_PHASE" }
  | { readonly type: "INSTALL_RULESET"; readonly ruleset: CardGameRuleset; readonly slug: string }
  | { readonly type: "UNINSTALL_RULESET"; readonly slug: string }
  | { readonly type: "SET_INSTALLED_SLUGS"; readonly slugs: readonly InstalledGame[] };
