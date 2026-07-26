// ─── Bridge Layer ──────────────────────────────────────────────────
// Host-client bridge types and reducer — shared between host and client.

export type { HostScreen, HostGameState, HostAction, CatalogGame, InstalledGame } from "./host-state";
export type {
  HostClientView,
  ClientScreen,
  RulesetSummary,
} from "./client-view";
export { createHostClientView, EMPTY_CLIENT_VIEW } from "./client-view";
export {
  createHostInitialState,
  deriveStatus,
  hostReducerImpl,
  hostReducer,
} from "./host-reducer";
