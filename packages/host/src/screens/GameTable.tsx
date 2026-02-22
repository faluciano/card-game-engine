// ─── Game Table Screen ─────────────────────────────────────────────
// The main game display shown on the TV / host device.
// Renders the public view of the game state.

import React from "react";

export function GameTable(): React.JSX.Element {
  // TODO: Subscribe to game state from engine
  // TODO: Render zones with cards (face-up/face-down per visibility)
  // TODO: Show current phase, turn indicator
  // TODO: Animate card movements between zones
  // TODO: Display scores
  return (
    <div data-testid="game-table">
      <h1>Game Table</h1>
    </div>
  );
}
