// ─── Host Bridge Reducer (re-exported from @card-engine/shared) ───
// Implementation lives in shared so both host and client can use them.

export {
  createHostInitialState,
  deriveStatus,
  hostReducerImpl,
  hostReducer,
} from "@card-engine/shared";
