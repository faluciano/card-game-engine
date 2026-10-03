import { describe, it, expect } from "vitest";
import { getNpcScoreRows } from "./npc-scores";

describe("getNpcScoreRows", () => {
  it("humanises non-player *_score keys", () => {
    expect(getNpcScoreRows({ dealer_score: 19, house_bank_score: 3 })).toEqual([
      { label: "Dealer", score: 19 },
      { label: "House Bank", score: 3 },
    ]);
  });

  it("ignores player scores, results and unrelated keys", () => {
    expect(getNpcScoreRows({ "player_score:0": 20, "result:0": 1, p1: 5, dealer: 2 })).toEqual([]);
  });

  it("returns an empty list for no scores", () => {
    expect(getNpcScoreRows({})).toEqual([]);
  });
});
