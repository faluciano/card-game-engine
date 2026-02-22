// ─── Action Bar ────────────────────────────────────────────────────
// Displays available actions for the current player.
// Buttons are dynamically enabled/disabled based on valid actions.

import React from "react";

export function ActionBar(): React.JSX.Element {
  // TODO: Receive validActions from PlayerView
  // TODO: Render action buttons (hit, stand, draw, etc.)
  // TODO: Disable buttons when not player's turn
  // TODO: Send selected action to host
  return (
    <div data-testid="action-bar">
      <p>Actions</p>
    </div>
  );
}
