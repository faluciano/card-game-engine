// ─── @card-engine/host-core ────────────────────────────────────────
// Framework-light host logic shared by the Android TV host and the browser
// display: catalog fetching, ruleset import, install/uninstall hooks,
// the game orchestrator, built-in rulesets, and theme tokens.
// Persistence is injected through the RulesetStore interface.

export type { RulesetStore, StoredRuleset } from "./ruleset-store";
export {
  BUILT_IN_RULESETS,
  BUILT_IN_SLUGS,
  BUILT_IN_INSTALLED,
} from "./built-in-rulesets";
export { formatZodIssues } from "./format-zod-issues";
export { importFromUrl, type UrlImportResult } from "./url-importer";
export {
  useCatalog,
  parseCatalogEnvelope,
  CATALOG_BASE_URL,
  type CatalogState,
  type UseCatalogResult,
} from "./use-catalog";
export { useGameOrchestrator } from "./use-game-orchestrator";
export {
  useInstalledSlugs,
  useRulesetInstaller,
  useRulesetUninstaller,
  mergeSlugs,
  type InstalledSlug,
} from "./ruleset-hooks";
export {
  useRulesetStore,
  type ImportResult,
  type UseRulesetStoreResult,
} from "./use-ruleset-store";
export { colors, type Colors } from "./theme";
