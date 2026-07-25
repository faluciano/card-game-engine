import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";
import { RelayDisplayHost } from "@couch-kit/display";
import {
  hostReducer,
  createHostInitialState,
  type HostGameState,
  type HostAction,
} from "@card-engine/shared";

const RELAY_URL =
  import.meta.env.VITE_RELAY_URL ??
  "wss://couch-kit-relay.icycliff-4c194e2e.eastus.azurecontainerapps.io";

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
    });
    return { display, roomId };
  });

  useEffect(() => () => display.stop(), [display]);

  const state = useSyncExternalStore(display.subscribe, display.getState);
  const players = Object.values(state.players).filter((p) => p.connected);
  const joinUrl = CONTROLLER_URL
    ? `${CONTROLLER_URL}${CONTROLLER_URL.includes("?") ? "&" : "?"}room=${roomId}`
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        backgroundColor: "#0f172a",
        color: "white",
        fontFamily: "system-ui, sans-serif",
        gap: "1.25rem",
        padding: "2rem",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ margin: 0, fontSize: "2.5rem" }}>Card Game</h1>

      <div style={{ textAlign: "center" }}>
        {joinUrl && (
          <div style={{ fontSize: "1rem", opacity: 0.7, marginBottom: "0.75rem" }}>
            Scan to join
          </div>
        )}
        {joinUrl && (
          <div
            style={{
              display: "inline-block",
              padding: "1rem",
              backgroundColor: "white",
              borderRadius: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <QRCode value={joinUrl} size={180} />
          </div>
        )}
        <div style={{ fontSize: "1rem", opacity: 0.7 }}>
          {joinUrl ? "or enter room code" : "Join with room code"}
        </div>
        <div style={{ fontSize: "4rem", fontWeight: 800, letterSpacing: "0.4rem" }}>
          {roomId}
        </div>
        {joinUrl ? (
          <a href={joinUrl} style={{ color: "#38bdf8", fontSize: "0.9rem" }}>
            {joinUrl}
          </a>
        ) : (
          <div style={{ fontSize: "0.85rem", opacity: 0.6 }}>
            Open the controller with <code>?room={roomId}</code>
          </div>
        )}
      </div>

      <ScreenPlaceholder state={state} playerCount={players.length} />
    </div>
  );
}

// Placeholder router: proves the relay-driven runtime works and shows current
// state. The full web ports of the ruleset picker, lobby, and game table land
// next (they reuse the host's pure orchestration hooks + a WebRulesetStore).
function ScreenPlaceholder({
  state,
  playerCount,
}: {
  state: HostGameState;
  playerCount: number;
}): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: "center",
        backgroundColor: "#1e293b",
        borderRadius: "0.75rem",
        padding: "1.5rem 2rem",
        minWidth: "18rem",
      }}
    >
      <div style={{ fontSize: "0.85rem", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.1rem" }}>
        Screen
      </div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.75rem" }}>
        {state.screen.tag}
      </div>
      <div style={{ opacity: 0.8 }}>Players connected: {playerCount}</div>
      {state.engineState && (
        <div style={{ opacity: 0.8, marginTop: "0.25rem" }}>
          Engine phase: {state.status}
        </div>
      )}
      <div style={{ fontSize: "0.8rem", opacity: 0.45, marginTop: "1rem" }}>
        Full table UI coming soon
      </div>
    </div>
  );
}
