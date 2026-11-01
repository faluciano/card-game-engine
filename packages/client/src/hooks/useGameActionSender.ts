// ─── useGameActionSender ───────────────────────────────────────────
// Sends a player's moves one at a time. While a move is in flight —
// sent, or accepted but its new view not yet here — further sends are
// dropped and `isLocked` disables the move buttons. A move the table
// did not take unlocks at once and surfaces a message for the toast.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { HostAction } from "@card-engine/shared";
import {
  APPLIED_UNLOCK_MS,
  IDLE_LOCK,
  describeActionFailure,
  isActionLocked,
  nextActionLock,
} from "../lib/action-lock.js";

/** What `sendActionWithResult` resolves with: the host's answer to one move. */
export type SendActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Sends a move and resolves once the host has answered (it never rejects). */
export type SendActionWithResult = (action: HostAction) => Promise<SendActionResult>;

export interface ActionFailureNotice {
  readonly message: string;
  /** Distinct per failure, to re-trigger the toast. */
  readonly key: number;
}

export interface GameActionSender {
  /** Sends the move unless one is already in flight. */
  readonly send: (action: HostAction) => void;
  readonly isLocked: boolean;
  /** The last move the table did not take, if any. */
  readonly failure: ActionFailureNotice | null;
}

/**
 * @param sendActionWithResult - From CouchKit's `useGameClient`.
 * @param view - The latest state from the host; a new value means the
 *   table has moved on, which releases an accepted move's lock.
 */
export function useGameActionSender(
  sendActionWithResult: SendActionWithResult,
  view: unknown,
): GameActionSender {
  const [lock, dispatch] = useReducer(nextActionLock, IDLE_LOCK);
  const [failure, setFailure] = useState<ActionFailureNotice | null>(null);
  // Synchronous mirror of `lock`: state updates are batched, so a second tap
  // in the same tick would otherwise slip past the guard.
  const lockedRef = useRef(false);
  lockedRef.current = isActionLocked(lock);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` is the deliberate trigger — each new state from the host releases an accepted move
  useEffect(() => {
    dispatch({ kind: "view_changed" });
  }, [view]);

  useEffect(() => {
    if (lock.kind !== "applied") return;
    const timer = setTimeout(() => dispatch({ kind: "timeout" }), APPLIED_UNLOCK_MS);
    return () => clearTimeout(timer);
  }, [lock]);

  const send = useCallback(
    (action: HostAction) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      dispatch({ kind: "send" });
      void sendActionWithResult(action).then((result) => {
        dispatch({ kind: "result", ok: result.ok });
        if (!result.ok) {
          setFailure({ message: describeActionFailure(result), key: Date.now() });
        }
      });
    },
    [sendActionWithResult],
  );

  return { send, isLocked: isActionLocked(lock), failure };
}
