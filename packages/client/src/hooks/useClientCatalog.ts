// ─── useClientCatalog ──────────────────────────────────────────────
// The phone's catalog: host-core's fetcher with a localStorage-backed,
// TTL-bounded stale-while-revalidate cache.

import { useCachedCatalog, type UseCachedCatalogResult } from "@card-engine/host-core/catalog";
import { safeLocalStorage } from "../lib/catalog-install.js";

/** Resolved once so the hook receives a stable storage reference. */
const CATALOG_STORAGE = safeLocalStorage();

export function useClientCatalog(): UseCachedCatalogResult {
  return useCachedCatalog({ storage: CATALOG_STORAGE });
}
