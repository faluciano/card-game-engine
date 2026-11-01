import { describe, it, expect } from "vitest";
import {
  IDLE_LOCK,
  describeActionFailure,
  isActionLocked,
  nextActionLock,
  type ActionLock,
  type ActionLockEvent,
} from "./action-lock.js";

// ─── nextActionLock ────────────────────────────────────────────────

function run(events: readonly ActionLockEvent[], from: ActionLock = IDLE_LOCK): ActionLock {
  return events.reduce(nextActionLock, from);
}

describe("nextActionLock", () => {
  it("locks on send", () => {
    expect(run([{ kind: "send" }])).toEqual({ kind: "sending" });
  });

  it("ignores a second send while one is in flight", () => {
    expect(run([{ kind: "send" }, { kind: "send" }])).toEqual({ kind: "sending" });
  });

  it("stays locked after acceptance until the next view arrives", () => {
    const applied = run([{ kind: "send" }, { kind: "result", ok: true }]);
    expect(applied).toEqual({ kind: "applied" });
    expect(nextActionLock(applied, { kind: "view_changed" })).toEqual(IDLE_LOCK);
  });

  it("unlocks an accepted move on timeout when no view arrives", () => {
    expect(run([{ kind: "send" }, { kind: "result", ok: true }, { kind: "timeout" }])).toEqual(
      IDLE_LOCK,
    );
  });

  it("unlocks at once when the move is refused", () => {
    expect(run([{ kind: "send" }, { kind: "result", ok: false }])).toEqual(IDLE_LOCK);
  });

  it("keeps waiting for the answer when another player's move changes the view", () => {
    expect(run([{ kind: "send" }, { kind: "view_changed" }])).toEqual({ kind: "sending" });
  });

  it("ignores stray results and timeouts while idle", () => {
    expect(run([{ kind: "result", ok: true }, { kind: "timeout" }])).toEqual(IDLE_LOCK);
  });
});

describe("isActionLocked", () => {
  it("is false only when idle", () => {
    expect(isActionLocked(IDLE_LOCK)).toBe(false);
    expect(isActionLocked({ kind: "sending" })).toBe(true);
    expect(isActionLocked({ kind: "applied" })).toBe(true);
  });
});

// ─── describeActionFailure ─────────────────────────────────────────

describe("describeActionFailure", () => {
  it("explains connection failures", () => {
    expect(describeActionFailure({ code: "NOT_CONNECTED", message: "x" })).toMatch(/wasn't sent/);
    expect(describeActionFailure({ code: "DISCONNECTED", message: "x" })).toMatch(
      /Lost the connection/,
    );
    expect(describeActionFailure({ code: "NO_RESULT", message: "x" })).toMatch(/didn't answer/);
  });

  it("explains rate limiting and reducer failures", () => {
    expect(describeActionFailure({ code: "RATE_LIMITED", message: "x" })).toBe(
      "Too many taps. Try again",
    );
    expect(describeActionFailure({ code: "ACTION_FAILED", message: "x" })).toBe(
      "The table couldn't apply that move",
    );
  });

  it("passes the host's reason through for refusals", () => {
    const reason = "Players cannot send RESET_ROUND; only the host can";
    expect(describeActionFailure({ code: "FORBIDDEN_ACTION", message: reason })).toBe(reason);
  });
});
