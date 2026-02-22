// ─── Bridge Layer ──────────────────────────────────────────────────
// Host-client bridge types and reducer — shared between host and client.

export type { HostScreen, HostGameState, HostAction } from "./host-state.js";
export {
  createHostInitialState,
  deriveStatus,
  hostReducerImpl,
  hostReducer,
} from "./host-reducer.js";
