// ─── useRulesetSync ────────────────────────────────────────────────
// Bundles the three host-side ruleset orchestration hooks that every
// host (TV app, browser display) must run together: seeding installed
// slugs on boot, then servicing install and uninstall requests from
// phones. Exposes each hook's last error so the host UI can show it.

import { useMemo } from "react";
import type { HostAction, HostGameState } from "@card-engine/shared";
import type { RulesetStore } from "./ruleset-store";
import { BUILT_IN_INSTALLED } from "./built-in-rulesets";
import {
  useInstalledSlugs,
  useRulesetInstaller,
  useRulesetUninstaller,
  type InstalledSlug,
} from "./ruleset-hooks";

/** Last error from each orchestration hook, or null where the last run succeeded. */
export interface RulesetSyncStatus {
  /** Reading the library on boot failed; built-ins were dispatched instead. */
  readonly loadError: string | null;
  /** The most recent phone-requested install was rejected or could not be saved. */
  readonly installError: string | null;
  /** The most recent phone-requested uninstall could not be completed. */
  readonly uninstallError: string | null;
}

/**
 * Runs {@link useInstalledSlugs}, {@link useRulesetInstaller} and
 * {@link useRulesetUninstaller} against one store and one host state.
 *
 * @param store - Platform ruleset store; pass a stable (module-level) instance.
 * @param state - Host state; only `pendingInstall` / `pendingUninstall` are read.
 * @param dispatch - Host dispatcher; must be referentially stable.
 * @param builtInInstalled - Bundled slug + version pairs. Defaults to {@link BUILT_IN_INSTALLED}.
 */
export function useRulesetSync(
  store: RulesetStore,
  state: Pick<HostGameState, "pendingInstall" | "pendingUninstall">,
  dispatch: (action: HostAction) => void,
  builtInInstalled: readonly InstalledSlug[] = BUILT_IN_INSTALLED,
): RulesetSyncStatus {
  const { error: loadError } = useInstalledSlugs(store, dispatch, builtInInstalled);
  const { error: installError } = useRulesetInstaller(
    store,
    state.pendingInstall,
    dispatch,
    builtInInstalled,
  );
  const { error: uninstallError } = useRulesetUninstaller(
    store,
    state.pendingUninstall,
    dispatch,
    builtInInstalled,
  );

  return useMemo(
    () => ({ loadError, installError, uninstallError }),
    [loadError, installError, uninstallError],
  );
}
