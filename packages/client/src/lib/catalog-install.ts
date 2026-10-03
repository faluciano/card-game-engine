// ─── Catalog Install Helpers ───────────────────────────────────────
// Small pure pieces behind `useCatalogInstaller`.

import type { CatalogGame } from "@card-engine/shared";
import type { CatalogCacheStorage } from "@card-engine/host-core/catalog";

/** Error banner shown when selecting a lobby game fails. */
export function formatSelectError(game: CatalogGame, err: unknown): string {
  const message = err instanceof Error ? err.message : "Selection failed";
  return `Could not select ${game.name}: ${message}`;
}

/**
 * `localStorage`, or null when the browser refuses access (private mode,
 * disabled storage, non-browser test environments).
 */
export function safeLocalStorage(): CatalogCacheStorage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Adds `slug` to an in-flight set; returns the same set when already present. */
export function markInFlight(set: ReadonlySet<string>, slug: string): ReadonlySet<string> {
  if (set.has(slug)) return set;
  return new Set(set).add(slug);
}

export function clearInFlight(set: ReadonlySet<string>, slug: string): ReadonlySet<string> {
  if (!set.has(slug)) return set;
  const next = new Set(set);
  next.delete(slug);
  return next;
}
