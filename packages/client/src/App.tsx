// ─── App ───────────────────────────────────────────────────────────
// Root component for the phone controller client.

import React from "react";
import { HandViewer } from "./components/HandViewer.js";
import { ActionBar } from "./components/ActionBar.js";
import { GameInfo } from "./components/GameInfo.js";

export function App(): React.JSX.Element {
  // TODO: Connect to host via WebSocket / WebRTC
  // TODO: Receive PlayerView from host
  // TODO: Send actions to host
  return (
    <div data-testid="client-app">
      <GameInfo />
      <HandViewer />
      <ActionBar />
    </div>
  );
}
