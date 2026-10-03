// ─── @card-engine/host-core/catalog ────────────────────────────────
// Framework-light subset of host-core for the phone controller: the
// catalog fetcher, the store card model, and the display formatters the
// client used to duplicate. This entry must stay free of
// `built-in-rulesets.ts` (which imports repo-root JSON) so the client
// bundle never pulls the bundled rulesets in — see `built-in-slugs.ts`.

export {
  CATALOG_BASE_URL,
  parseCatalogEnvelope,
  useCatalog,
  type CatalogState,
  type UseCatalogResult,
} from "../use-catalog";
export {
  fetchCatalogRuleset,
  findInstalledVersion,
  formatInstallError,
  formatPlayerRange,
  getStoreActions,
  type StoreAction,
  type StoreCardInput,
} from "../ruleset-picker-model";
export {
  SUIT_SYMBOLS,
  formatPhaseName,
  formatSuitName,
  formatZoneName,
  isRedSuit,
  suitSymbol,
  type NpcScoreRow,
} from "../game-table-model";
export { BUILT_IN_SLUGS, isBuiltInSlug } from "./built-in-slugs";
export { getNpcScoreRows } from "./npc-scores";
export {
  CATALOG_CACHE_KEY,
  DEFAULT_CATALOG_TTL_MS,
  isCatalogCacheFresh,
  parseCatalogCache,
  serializeCatalogCache,
  type CatalogCacheEntry,
  type CatalogCacheStorage,
} from "./catalog-cache";
export {
  useCachedCatalog,
  type CachedCatalogState,
  type UseCachedCatalogOptions,
  type UseCachedCatalogResult,
} from "./use-cached-catalog";
