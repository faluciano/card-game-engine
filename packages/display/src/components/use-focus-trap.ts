// ─── Focus Trap ────────────────────────────────────────────────────
// Keeps keyboard focus inside a modal while it is open and hands focus
// back to whatever opened it (the trigger) when it closes. The modal's
// shared host-core model stays platform-agnostic; this DOM-only concern
// lives with the web renderer.

import type { RefObject } from "react";
import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Tabbable descendants of `container`, in DOM order. */
function getFocusable(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * While `active`, wraps Tab / Shift+Tab within `containerRef` and pulls
 * stray focus back inside. When `active` turns false (or the component
 * unmounts) focus returns to the element that was focused on activation.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (container === null) return;

      const focusable = getFocusable(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        e.preventDefault();
        container.focus();
        return;
      }

      const current = document.activeElement;
      const isInside = current instanceof Node && container.contains(current);
      if (e.shiftKey && (!isInside || current === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!isInside || current === last)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to the trigger if it is still on the page.
      if (trigger?.isConnected) trigger.focus();
    };
  }, [active, containerRef]);
}
