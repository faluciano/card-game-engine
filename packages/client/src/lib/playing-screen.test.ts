import { describe, it, expect } from "vitest";
import type { Card, CardInstanceId, FilteredZoneState, ValidAction } from "@card-engine/shared";
import {
  COMPACT_ZONE_NAMES,
  actionFingerprint,
  pickNewRoundAction,
  splitCompactZones,
  visibleCards,
} from "./playing-screen.js";

const card = (id: string): Card => ({
  id: id as CardInstanceId,
  suit: "hearts",
  rank: "A",
  faceUp: true,
});

const zone = (name: string, cards: readonly (Card | null)[]): FilteredZoneState => ({
  name,
  cards,
  cardCount: cards.length,
});

const action = (actionName: string, enabled = true, label = actionName): ValidAction => ({
  actionName,
  label,
  enabled,
});

describe("splitCompactZones", () => {
  it("separates discard and draw_pile from the hand zones", () => {
    const zones = {
      "hand:0": zone("hand:0", [card("a")]),
      discard: zone("discard", [card("b")]),
      draw_pile: zone("draw_pile", [null, null]),
    };
    const split = splitCompactZones(zones);
    expect(Object.keys(split.handZones)).toEqual(["hand:0"]);
    expect(split.discardZone).toBe(zones.discard);
    expect(split.deckZone).toBe(zones.draw_pile);
    expect(split.deckZoneName).toBe("draw_pile");
  });

  it("falls back to a zone named deck", () => {
    const zones = { deck: zone("deck", [null]) };
    const split = splitCompactZones(zones);
    expect(split.deckZoneName).toBe("deck");
    expect(split.deckZone).toBe(zones.deck);
    expect(split.discardZone).toBeNull();
  });

  it("prefers draw_pile when both names exist and leaves deck out of the hand", () => {
    const zones = { draw_pile: zone("draw_pile", []), deck: zone("deck", []) };
    const split = splitCompactZones(zones);
    expect(split.deckZoneName).toBe("draw_pile");
    expect(split.handZones).toEqual({});
  });

  it("returns nulls and keeps every other zone when there are no piles", () => {
    const zones = { "hand:1": zone("hand:1", []), community: zone("community", []) };
    const split = splitCompactZones(zones);
    expect(split.handZones).toEqual(zones);
    expect(split.discardZone).toBeNull();
    expect(split.deckZone).toBeNull();
  });

  it("every compact zone name is excluded from the hand view", () => {
    const zones = Object.fromEntries([...COMPACT_ZONE_NAMES].map((n) => [n, zone(n, [])]));
    expect(splitCompactZones(zones).handZones).toEqual({});
  });
});

describe("visibleCards", () => {
  it("drops hidden placeholders and keeps order", () => {
    const z = zone("discard", [card("top"), null, card("bottom")]);
    expect(visibleCards(z).map((c) => c.id)).toEqual(["top", "bottom"]);
  });

  it("is empty for a missing zone", () => {
    expect(visibleCards(null)).toEqual([]);
  });
});

describe("actionFingerprint", () => {
  it("is order-independent", () => {
    expect(actionFingerprint([action("hit"), action("stand")])).toBe(
      actionFingerprint([action("stand"), action("hit")]),
    );
  });

  it("changes when the action set changes", () => {
    expect(actionFingerprint([action("hit")])).not.toBe(actionFingerprint([action("stand")]));
    expect(actionFingerprint([])).toBe("");
  });
});

describe("pickNewRoundAction", () => {
  it("prefers an action that reads as a new round", () => {
    const picked = pickNewRoundAction([action("surrender"), action("new_round")]);
    expect(picked?.actionName).toBe("new_round");
  });

  it.each(["next_round", "play_again", "continue"])("recognises %s", (name) => {
    expect(pickNewRoundAction([action("other"), action(name)])?.actionName).toBe(name);
  });

  it("matches on the display label too", () => {
    const picked = pickNewRoundAction([action("other"), action("go", true, "Deal Again")]);
    expect(picked?.actionName).toBe("go");
  });

  it("never picks play_card or a disabled action", () => {
    expect(pickNewRoundAction([action("play_card"), action("new_round", false)])).toBeNull();
  });

  it("falls back to the first enabled declaration", () => {
    expect(pickNewRoundAction([action("play_card"), action("a"), action("b")])?.actionName).toBe(
      "a",
    );
  });

  it("returns null for no actions", () => {
    expect(pickNewRoundAction([])).toBeNull();
  });
});
