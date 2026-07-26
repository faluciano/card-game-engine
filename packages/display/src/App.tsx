import { useEffect, useState, useSyncExternalStore } from "react";
import { RelayDisplayHost } from "@couch-kit/display";
import {
  hostReducer,
  createHostInitialState,
  createHostClientView,
  type HostGameState,
  type HostAction,
} from "@card-engine/shared";
import { BUILT_IN_INSTALLED } from "./host-logic/built-in-rulesets.js";
import {
  useInstalledSlugs,
  useRulesetInstaller,
  useRulesetUninstaller,
} from "./host-logic/ruleset-hooks.js";
import { ScreenRouter } from "./ScreenRouter.js";
import { colors } from "./theme.js";

const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ??
  "wss://couch-kit-relay.faluciano.workers.dev";

// Base URL of the deployed controller. The join link appends `?room=CODE`.
const CONTROLLER_URL = import.meta.env.VITE_CONTROLLER_URL ?? "";

// Unambiguous room code (no easily-confused characters).
function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 4 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

export function App(): React.JSX.Element {
  const [{ display, roomId }] = useState(() => {
    const roomId = makeRoomCode();
    const display = new RelayDisplayHost<HostGameState, HostAction>({
      url: RELAY_URL,
      roomId,
      reducer: hostReducer,
      initialState: createHostInitialState(),
      // Each phone receives only its own hand and the moves it may make.
      // Without this the whole engine state — every hand — goes to every
      // player, and hiding cards is left to the client's good manners.
      project: createHostClientView,
    });
    return { display, roomId };
  });

  useEffect(() => () => display.stop(), [display]);

  const state = useSyncExternalStore(display.subscribe, display.getState);

  // Host-side ruleset orchestration (seeds built-ins, handles install/uninstall
  // requested by phones) — the same hooks the Android TV host runs.
  useInstalledSlugs(display.dispatch, BUILT_IN_INSTALLED);
  useRulesetInstaller(state.pendingInstall, display.dispatch, BUILT_IN_INSTALLED);
  useRulesetUninstaller(state.pendingUninstall, display.dispatch, BUILT_IN_INSTALLED);

  const joinUrl = CONTROLLER_URL
    ? `${CONTROLLER_URL}${CONTROLLER_URL.includes("?") ? "&" : "?"}room=${roomId}`
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: colors.bg,
        color: colors.text,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <ScreenRouter
        state={state}
        dispatch={display.dispatch}
        joinUrl={joinUrl}
        roomId={roomId}
      />
    </div>
  );
}
