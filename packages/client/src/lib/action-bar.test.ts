import { describe, it, expect } from "vitest";
import type { CardInstanceId, Player, PlayerId, ValidAction } from "@card-engine/shared";
import {
  buildGameAction,
  hasCardSelectionAction,
  hasPlayCardAction,
  isSuitPickerPhase,
  needsCardSelectionHint,
  otherPlayerTargets,
  targetsOtherPlayer,
} from "./action-bar.js";

const action = (actionName: string, enabled = true): ValidAction => ({
  actionName,
  label: actionName,
  enabled,
});

const PLAYER = "p1" as PlayerId;
const SELECTED = { cardId: "c1" as CardInstanceId, zoneName: "hand:0", rank: "7" };

const PLAY_CARD: ValidAction = { ...action("play_card"), targetZone: "trick:0" };

/** Go Fish's ask: rank from the selected card, target from a tapped player. */
const ASK: ValidAction = {
  ...action("ask"),
  params: { rank: { kind: "selected_card_rank" }, target: { kind: "other_player" } },
};

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

  it("counts declares that take the selected card's rank as needing a selection", () => {
    expect(hasCardSelectionAction([ASK])).toBe(true);
    expect(hasCardSelectionAction([action("play_card")])).toBe(true);
    expect(hasCardSelectionAction([action("draw")])).toBe(false);
    expect(needsCardSelectionHint([ASK], null)).toBe(true);
    expect(needsCardSelectionHint([ASK], SELECTED)).toBe(false);
  });

  it("hints only while an enabled play_card has no selection", () => {
    expect(needsCardSelectionHint([action("play_card")], null)).toBe(true);
    expect(needsCardSelectionHint([action("play_card")], SELECTED)).toBe(false);
    expect(needsCardSelectionHint([action("play_card", false)], null)).toBe(false);
    expect(needsCardSelectionHint([action("draw")], null)).toBe(false);
  });
});

describe("otherPlayerTargets / targetsOtherPlayer", () => {
  const player = (id: string, name: string): Player => ({
    id: id as PlayerId,
    name,
    role: "player",
    connected: true,
  });

  it("lists every other player with their engine index", () => {
    const players = [player("p0", "Ann"), player("p1", "Ben"), player("p2", "Cy")];
    expect(otherPlayerTargets(players, "p1" as PlayerId)).toEqual([
      { index: 0, player: players[0] },
      { index: 2, player: players[2] },
    ]);
  });

  it("detects actions with an other_player param", () => {
    expect(targetsOtherPlayer(ASK)).toBe(true);
    expect(targetsOtherPlayer(action("stand"))).toBe(false);
  });
});

describe("buildGameAction", () => {
  it("builds a play_card action to the engine's target zone", () => {
    expect(buildGameAction(PLAY_CARD, PLAYER, SELECTED)).toEqual({
      type: "GAME_ACTION",
      action: {
        kind: "play_card",
        playerId: PLAYER,
        cardId: SELECTED.cardId,
        fromZone: "hand:0",
        toZone: "trick:0",
      },
    });
  });

  it("refuses play_card without a selected card or target zone", () => {
    expect(buildGameAction(PLAY_CARD, PLAYER, null)).toBeNull();
    expect(buildGameAction(action("play_card"), PLAYER, SELECTED)).toBeNull();
  });

  it("treats an action without params as a plain declaration", () => {
    expect(buildGameAction(action("stand"), PLAYER, null)).toEqual({
      type: "GAME_ACTION",
      action: { kind: "declare", playerId: PLAYER, declaration: "stand" },
    });
  });

  it("fills params from the selected card's rank and the target player", () => {
    expect(buildGameAction(ASK, PLAYER, SELECTED, 2)).toEqual({
      type: "GAME_ACTION",
      action: {
        kind: "declare",
        playerId: PLAYER,
        declaration: "ask",
        params: { rank: "7", target: 2 },
      },
    });
  });

  it("refuses a declare while a param is missing", () => {
    expect(buildGameAction(ASK, PLAYER, null, 2)).toBeNull();
    expect(buildGameAction(ASK, PLAYER, SELECTED)).toBeNull();
  });
});
