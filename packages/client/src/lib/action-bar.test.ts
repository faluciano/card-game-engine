import { describe, it, expect } from "vitest";
import type { CardInstanceId, PlayerId, ValidAction } from "@card-engine/shared";
import {
  DEFAULT_PLAY_TARGET_ZONE,
  buildGameAction,
  hasPlayCardAction,
  isSuitPickerPhase,
  needsCardSelectionHint,
} from "./action-bar.js";

const action = (actionName: string, enabled = true): ValidAction => ({
  actionName,
  label: actionName,
  enabled,
});

const PLAYER = "p1" as PlayerId;
const SELECTED = { cardId: "c1" as CardInstanceId, zoneName: "hand:0" };

describe("isSuitPickerPhase", () => {
  it("is true when every action is a suit choice", () => {
    const actions = ["choose_hearts", "choose_diamonds", "choose_clubs", "choose_spades"].map((n) =>
      action(n),
    );
    expect(isSuitPickerPhase(actions)).toBe(true);
  });

  it("is false for an empty list", () => {
    expect(isSuitPickerPhase([])).toBe(false);
  });

  it("is false when a non-suit action is mixed in", () => {
    expect(isSuitPickerPhase([action("choose_hearts"), action("draw")])).toBe(false);
  });
});

describe("hasPlayCardAction / needsCardSelectionHint", () => {
  it("detects a play_card action", () => {
    expect(hasPlayCardAction([action("draw"), action("play_card")])).toBe(true);
    expect(hasPlayCardAction([action("draw")])).toBe(false);
  });

  it("hints only while an enabled play_card has no selection", () => {
    expect(needsCardSelectionHint([action("play_card")], null)).toBe(true);
    expect(needsCardSelectionHint([action("play_card")], SELECTED)).toBe(false);
    expect(needsCardSelectionHint([action("play_card", false)], null)).toBe(false);
    expect(needsCardSelectionHint([action("draw")], null)).toBe(false);
  });
});

describe("buildGameAction", () => {
  it("builds a play_card action from the selected card", () => {
    expect(buildGameAction("play_card", PLAYER, SELECTED)).toEqual({
      type: "GAME_ACTION",
      action: {
        kind: "play_card",
        playerId: PLAYER,
        cardId: SELECTED.cardId,
        fromZone: "hand:0",
        toZone: DEFAULT_PLAY_TARGET_ZONE,
      },
    });
  });

  it("refuses play_card without a selected card", () => {
    expect(buildGameAction("play_card", PLAYER, null)).toBeNull();
  });

  it("treats every other action as a declaration", () => {
    expect(buildGameAction("stand", PLAYER, null)).toEqual({
      type: "GAME_ACTION",
      action: { kind: "declare", playerId: PLAYER, declaration: "stand" },
    });
  });
});
