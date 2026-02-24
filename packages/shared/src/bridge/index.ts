// ─── Bridge Layer ──────────────────────────────────────────────────
// Host-client bridge types and reducer — shared between host and client.

export type { HostScreen, HostGameState, HostAction, CatalogGame, InstalledGame } from "./host-state";
export {
  createHostInitialState,
  deriveStatus,
  hostReducerImpl,
  hostReducer,
} from "./host-reducer";
