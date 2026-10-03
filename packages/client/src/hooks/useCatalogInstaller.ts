// ─── useCatalogInstaller ───────────────────────────────────────────
// Downloads + validates a catalog ruleset (via host-core, so the phone
// and TV behave identically) and hands it to the host. Tracks in-flight
// slugs so a double-tap cannot fire two installs, and surfaces the last
// failure as a banner message.

import { useCallback, useRef, useState } from "react";
import type { CatalogGame, HostAction } from "@card-engine/shared";
import { fetchCatalogRuleset, formatInstallError } from "@card-engine/host-core/catalog";
import { clearInFlight, formatSelectError, markInFlight } from "../lib/catalog-install.js";

export interface CatalogInstaller {
  /** Last install/select failure, cleared on the next attempt. */
  readonly error: string | null;
  /** Slugs currently being downloaded (install or select). */
  readonly inFlight: ReadonlySet<string>;
  readonly install: (game: CatalogGame) => void;
  readonly select: (game: CatalogGame) => void;
  readonly uninstall: (slug: string) => void;
}

type Outcome = "install" | "select";

export function useCatalogInstaller(sendAction: (action: HostAction) => void): CatalogInstaller {
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set());
  // Synchronous mirror of `inFlight`: state updates are batched, so a second
  // tap in the same tick would otherwise slip past the guard.
  const inFlightRef = useRef<ReadonlySet<string>>(inFlight);

  const run = useCallback(
    async (game: CatalogGame, outcome: Outcome): Promise<void> => {
      if (inFlightRef.current.has(game.slug)) return;
      inFlightRef.current = markInFlight(inFlightRef.current, game.slug);
      setInFlight(inFlightRef.current);
      setError(null);

      try {
        const ruleset = await fetchCatalogRuleset(game);
        if (outcome === "install") {
          sendAction({ type: "INSTALL_RULESET", ruleset, slug: game.slug });
        } else {
          sendAction({ type: "SELECT_RULESET", ruleset });
        }
      } catch (err) {
        setError(
          outcome === "install" ? formatInstallError(game, err) : formatSelectError(game, err),
        );
      } finally {
        inFlightRef.current = clearInFlight(inFlightRef.current, game.slug);
        setInFlight(inFlightRef.current);
      }
    },
    [sendAction],
  );

  const install = useCallback((game: CatalogGame) => void run(game, "install"), [run]);
  const select = useCallback((game: CatalogGame) => void run(game, "select"), [run]);
  const uninstall = useCallback(
    (slug: string) => {
      setError(null);
      sendAction({ type: "UNINSTALL_RULESET", slug });
    },
    [sendAction],
  );

  return { error, inFlight, install, select, uninstall };
}
