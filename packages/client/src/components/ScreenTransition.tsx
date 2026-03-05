// ─── Screen Transition ─────────────────────────────────────────────
// Wraps screen content with a fade-in + slide-up animation on mount.
// Parent must change `key` to trigger re-mount on screen change.

import React from "react";

const transitionStyle: React.CSSProperties = {
  animation: "screenFadeIn 250ms ease-out both",
  display: "contents",
};

export function ScreenTransition({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <div style={transitionStyle}>{children}</div>;
}
