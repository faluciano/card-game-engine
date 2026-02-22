// ─── Hand Viewer ───────────────────────────────────────────────────
// Displays the player's hand (cards only they can see).
// Renders on the phone screen with swipe/tap interactions.

import React from "react";

export function HandViewer(): React.JSX.Element {
  // TODO: Receive cards from PlayerView.zones[myHand]
  // TODO: Render cards in a fan layout
  // TODO: Tap to select, swipe to play
  return (
    <div data-testid="hand-viewer">
      <p>Your Hand</p>
    </div>
  );
}
