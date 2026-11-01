// ─── Action Lock ───────────────────────────────────────────────────
// Keeps a player's move buttons locked from the tap until the table has
// answered, so a double tap cannot send the move twice (two Blackjack
// hits from one press). The host acknowledges a move before the state
// it produced arrives, so an accepted move stays locked until the next
// view (or a short fallback, for moves that change nothing).

/** Where the player's last move stands. */
export type ActionLock =
  /** Nothing in flight: buttons are live. */
  | { readonly kind: "idle" }
  /** Sent; waiting for the host's answer. */
  | { readonly kind: "sending" }
  /** Accepted; waiting for the view it produced. */
  | { readonly kind: "applied" };

export type ActionLockEvent =
  | { readonly kind: "send" }
  | { readonly kind: "result"; readonly ok: boolean }
  | { readonly kind: "view_changed" }
  | { readonly kind: "timeout" };

export const IDLE_LOCK: ActionLock = { kind: "idle" };

/**
 * How long an accepted move stays locked when no new view arrives —
 * a move that changed nothing produces no update.
 */
export const APPLIED_UNLOCK_MS = 1500;

/** Advances the lock. Events that do not apply to the current state leave it unchanged. */
export function nextActionLock(lock: ActionLock, event: ActionLockEvent): ActionLock {
  switch (event.kind) {
    case "send":
      return lock.kind === "idle" ? { kind: "sending" } : lock;
    case "result":
      if (lock.kind !== "sending") return lock;
      return event.ok ? { kind: "applied" } : IDLE_LOCK;
    case "view_changed":
    case "timeout":
      return lock.kind === "applied" ? IDLE_LOCK : lock;
  }
}

/** Whether move buttons should be disabled. */
export function isActionLocked(lock: ActionLock): boolean {
  return lock.kind !== "idle";
}

// ─── Failure Messages ──────────────────────────────────────────────

/** A move the table did not take, as `sendActionWithResult` reports it. */
export interface ActionFailure {
  readonly code: string;
  readonly message: string;
}

/** Explains to the player why a move did not go through. */
export function describeActionFailure({ code, message }: ActionFailure): string {
  switch (code) {
    case "NOT_CONNECTED":
      return "Not connected to the table, so your move wasn't sent";
    case "DISCONNECTED":
      return "Lost the connection before the table answered. Check whether your move went through";
    case "NO_RESULT":
      return "The table didn't answer. Check whether your move went through";
    case "RATE_LIMITED":
      return "Too many taps. Try again";
    case "ACTION_FAILED":
      return "The table couldn't apply that move";
    default:
      // FORBIDDEN_ACTION and anything newer carry the host's own reason.
      return message;
  }
}
