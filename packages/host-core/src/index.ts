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
export {
  DEAL_DURATION_MS,
  DEAL_MARK_CLEAR_MS,
  DEAL_SLIDE_OFFSET,
  DEAL_STAGGER_MS,
  FLIP_DURATION_MS,
  MAX_VISIBLE_CARDS,
  STACK_COLLAPSE_THRESHOLD,
  SUIT_SYMBOLS,
  cardInkColor,
  formatPhaseName,
  formatStatusKind,
  formatSuitName,
  formatZoneName,
  getActiveSuitModel,
  getCappedCardList,
  getNpcScores,
  getPlayerResultRows,
  getPlayerZoneGroups,
  getResultsOverlayModel,
  getScoreRows,
  getSharedZones,
  getStatusBarModel,
  getZoneDisplayMode,
  isPlayerZone,
  isPublicOnTable,
  isRedSuit,
  nextNewCardStartIndex,
  resolveScoreLabel,
  resolveTableColor,
  resolveWinnerName,
  revealCards,
  suitSymbol,
  type ActiveSuitModel,
  type CappedCard,
  type CappedCardList,
  type NpcScoreRow,
  type PlayerResultRow,
  type PlayerZoneGroup,
  type ResultsOverlayModel,
  type ScoreRow,
  type StatusBarModel,
  type ZoneDisplayMode,
  type ZoneEntry,
} from "./game-table-model";
export {
  useFlipOnReveal,
  useGameTableModel,
  useZoneModel,
  type GameTableModel,
  type PlayerSectionModel,
  type ZoneModel,
  type ZoneViewModel,
} from "./use-game-table-model";
export {
  IMPORT_AUTO_CLOSE_DELAY_MS,
  IMPORT_FOCUS_DELAY_MS,
  IMPORT_URL_PLACEHOLDER,
  importResultToState,
  nextAvailableSlug,
  resolveImportSlug,
  useImportModalModel,
  type ImportModalInput,
  type ImportModalModel,
  type ImportModalState,
} from "./use-import-modal-model";
export {
  PICKER_TABS,
  buildRulesetItems,
  fetchCatalogRuleset,
  findInstalledVersion,
  formatInstallError,
  formatPlayerRange,
  getStoreActions,
  type PickerTab,
  type RulesetItem,
  type StoreAction,
  type StoreCardInput,
} from "./ruleset-picker-model";
export {
  useRulesetPickerModel,
  useStoreViewModel,
  type RulesetPickerModel,
  type StoreGameModel,
  type StoreViewModel,
} from "./use-ruleset-picker-model";
