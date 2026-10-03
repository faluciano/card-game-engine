import { describe, it, expect } from "vitest";
import {
  DELETE_CONFIRM_LABEL,
  DELETE_CONFIRM_TIMEOUT_MS,
  DELETE_LABEL,
  cancelDeleteConfirm,
  deleteLabel,
  pressDelete,
} from "./use-ruleset-picker-model";

// ─── pressDelete ───────────────────────────────────────────────────

describe("pressDelete", () => {
  it("arms an idle card without deleting", () => {
    expect(pressDelete(null, "war")).toEqual({ confirmingKey: "war", shouldDelete: false });
  });

  it("deletes on the second press of the same card and disarms", () => {
    const first = pressDelete(null, "war");
    expect(pressDelete(first.confirmingKey, "war")).toEqual({
      confirmingKey: null,
      shouldDelete: true,
    });
  });

  it("moves the armed state to another card instead of deleting it", () => {
    expect(pressDelete("war", "crazy-eights")).toEqual({
      confirmingKey: "crazy-eights",
      shouldDelete: false,
    });
  });

  it("requires two fresh presses after a cancel", () => {
    const cancelled = cancelDeleteConfirm(pressDelete(null, "war").confirmingKey);
    expect(pressDelete(cancelled, "war").shouldDelete).toBe(false);
  });
});

// ─── cancelDeleteConfirm ───────────────────────────────────────────

describe("cancelDeleteConfirm", () => {
  it("disarms any card when no key is given", () => {
    expect(cancelDeleteConfirm("war")).toBeNull();
  });

  it("disarms the matching card", () => {
    expect(cancelDeleteConfirm("war", "war")).toBeNull();
  });

  it("leaves a different armed card alone", () => {
    expect(cancelDeleteConfirm("war", "crazy-eights")).toBe("war");
  });

  it("is a no-op when nothing is armed", () => {
    expect(cancelDeleteConfirm(null, "war")).toBeNull();
    expect(cancelDeleteConfirm(null)).toBeNull();
  });
});

// ─── deleteLabel ───────────────────────────────────────────────────

describe("deleteLabel", () => {
  it("shows the plain label when nothing is armed", () => {
    expect(deleteLabel(null, "war")).toBe(DELETE_LABEL);
  });

  it("prompts for a second press on the armed card", () => {
    expect(deleteLabel("war", "war")).toBe(DELETE_CONFIRM_LABEL);
  });

  it("keeps the plain label on other cards", () => {
    expect(deleteLabel("war", "crazy-eights")).toBe(DELETE_LABEL);
  });
});

// ─── Timeout ───────────────────────────────────────────────────────

describe("DELETE_CONFIRM_TIMEOUT_MS", () => {
  it("gives the user a few seconds to confirm", () => {
    expect(DELETE_CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    expect(DELETE_CONFIRM_TIMEOUT_MS).toBeLessThanOrEqual(10000);
  });
});
