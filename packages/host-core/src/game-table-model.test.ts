import { describe, it, expect } from "vitest";
import type { Card, CardGameState, Player, ZoneState } from "@card-engine/shared";
import {
  MAX_VISIBLE_CARDS,
  DEAL_STAGGER_MS,
  cardInkColor,
  formatPhaseName,
  formatStatusKind,
  formatSuitName,
  formatZoneName,
  getActiveSuitModel,
  getCappedCardList,
  getNpcScores,
  getPlayerResultRows,
  getPlayerZoneGroups,
  getResultsOverlayModel,
  getScoreRows,
  getSharedZones,
  getStatusBarModel,
  getZoneDisplayMode,
  isPlayerZone,
  isPublicOnTable,
  isRedSuit,
  nextNewCardStartIndex,
  resolveScoreLabel,
  resolveTableColor,
  resolveWinnerName,
  revealCards,
  suitSymbol,
} from "./game-table-model";
import { colors } from "./theme";

// ─── Fixtures ──────────────────────────────────────────────────────

function card(id: string, suit = "spades", rank = "A", faceUp = true): Card {
  return { id, suit, rank, faceUp } as unknown as Card;
}

function cards(n: number, faceUp: boolean): Card[] {
  return Array.from({ length: n }, (_, i) => card(`c${i}`, "spades", "A", faceUp));
}

function player(id: string, name: string): Player {
  return { id, name, role: "player", connected: true } as unknown as Player;
}

function zone(cardList: readonly Card[]): ZoneState {
  return { definition: { name: "x", visibility: { kind: "public" }, owners: [] }, cards: cardList };
}

function engine(overrides: Partial<CardGameState> = {}): CardGameState {
  const base = {
    ruleset: {
      zones: [
        { name: "deck", visibility: { kind: "hidden" }, owners: [] },
        {
          name: "hand",
          visibility: { kind: "owner_only" },
          owners: ["player"],
          phaseOverrides: [{ phase: "showdown", visibility: { kind: "public" } }],
        },
        { name: "discard", visibility: { kind: "public" }, owners: [] },
      ],
      ui: undefined,
    },
    status: { kind: "in_progress", startedAt: 0 },
    players: [player("p1", "Alice"), player("p2", "  bob")],
    zones: {
      deck: zone(cards(3, false)),
      discard: zone([]),
      "hand:0": zone(cards(2, false)),
      "hand:1": zone([]),
    },
    currentPhase: "player_turns",
    currentPlayerIndex: 1,
    turnNumber: 4,
    scores: {},
    stringVariables: {},
  };
  return { ...base, ...overrides } as unknown as CardGameState;
}

// ─── Zone grouping ─────────────────────────────────────────────────

describe("zone grouping", () => {
  it("detects per-player zone names", () => {
    expect(isPlayerZone("hand:0")).toBe(true);
    expect(isPlayerZone("hand:12")).toBe(true);
    expect(isPlayerZone("draw_pile")).toBe(false);
    expect(isPlayerZone("hand:a")).toBe(false);
  });

  it("returns only shared zones", () => {
    expect(getSharedZones(engine()).map(([name]) => name)).toEqual(["deck", "discard"]);
  });

  it("groups player zones and skips players with none", () => {
    const groups = getPlayerZoneGroups(engine({ scores: { "player_score:0": 17 } }));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      index: 0,
      isCurrentTurn: false,
      score: 17,
      initial: "A",
    });
    expect(groups[0]!.zones.map(([name]) => name)).toEqual(["hand:0"]);
    expect(groups[1]).toMatchObject({ index: 1, isCurrentTurn: true, score: null, initial: "B" });
  });

  it("falls back to ? for an empty player name", () => {
    const state = engine({ players: [player("p1", "   ")] });
    expect(getPlayerZoneGroups(state)[0]!.initial).toBe("?");
  });
});

// ─── Visibility ────────────────────────────────────────────────────

describe("isPublicOnTable", () => {
  it("is true for public zones", () => {
    expect(isPublicOnTable(engine(), "discard")).toBe(true);
  });

  it("is false for hidden and owner-only zones", () => {
    expect(isPublicOnTable(engine(), "deck")).toBe(false);
    expect(isPublicOnTable(engine(), "hand:0")).toBe(false);
  });

  it("honours phase overrides", () => {
    expect(isPublicOnTable(engine({ currentPhase: "showdown" }), "hand:1")).toBe(true);
  });

  it("is false for zones missing from the ruleset", () => {
    expect(isPublicOnTable(engine(), "ghost")).toBe(false);
  });
});

// ─── Formatting ────────────────────────────────────────────────────

describe("formatting", () => {
  it("formats phase names", () => {
    expect(formatPhaseName("player_turns")).toBe("Player Turns");
    expect(formatPhaseName("deal")).toBe("Deal");
  });

  it("formats zone names, stripping the player suffix", () => {
    expect(formatZoneName("draw_pile")).toBe("Draw Pile");
    expect(formatZoneName("hand:0")).toBe("Hand");
  });

  it("formats status kinds", () => {
    expect(formatStatusKind("waiting_for_players")).toBe("Waiting for Players");
    expect(formatStatusKind("in_progress")).toBe("In Progress");
    expect(formatStatusKind("paused")).toBe("Paused");
    expect(formatStatusKind("finished")).toBe("Finished");
    expect(formatStatusKind("weird")).toBe("weird");
  });

  it("resolves score labels", () => {
    const players = [player("p1", "Alice")];
    expect(resolveScoreLabel("player_score:0", players)).toBe("Alice");
    expect(resolveScoreLabel("player_score:9", players)).toBe("player_score:9");
    expect(resolveScoreLabel("result:0", players)).toBe("Alice (Result)");
    expect(resolveScoreLabel("result:3", players)).toBe("result:3");
    expect(resolveScoreLabel("dealer_score", players)).toBe("Dealer Score");
  });

  it("builds the status bar model", () => {
    expect(getStatusBarModel(engine())).toEqual({
      phaseLabel: "Player Turns",
      statusLabel: "In Progress",
      currentPlayerName: "  bob",
      turnNumber: 4,
    });
    expect(getStatusBarModel(engine({ currentPlayerIndex: 7 })).currentPlayerName).toBeNull();
  });

  it("builds score rows in insertion order", () => {
    const rows = getScoreRows(engine({ scores: { "player_score:0": 5, dealer_score: 9 } }));
    expect(rows).toEqual([
      { key: "player_score:0", label: "Alice", score: 5 },
      { key: "dealer_score", label: "Dealer Score", score: 9 },
    ]);
  });
});

// ─── Table color ───────────────────────────────────────────────────

describe("resolveTableColor", () => {
  it("defaults when no ui config", () => {
    expect(resolveTableColor(undefined)).toBe(colors.tableBg);
  });

  it("uses the custom color when set", () => {
    expect(resolveTableColor({ layout: "grid", tableColor: "custom", customColor: "#123" })).toBe(
      "#123",
    );
  });

  it("falls back to the default for custom without a color", () => {
    expect(resolveTableColor({ layout: "grid", tableColor: "custom" })).toBe(colors.tableBg);
  });
});

// ─── Suits ─────────────────────────────────────────────────────────

describe("suits", () => {
  it("maps known suits to glyphs and passes unknown suits through", () => {
    expect(suitSymbol("hearts")).toBe("♥");
    expect(suitSymbol("stars")).toBe("stars");
  });

  it("colours red suits", () => {
    expect(isRedSuit("diamonds")).toBe(true);
    expect(isRedSuit("clubs")).toBe(false);
    expect(cardInkColor(card("c", "hearts"))).toBe(colors.suitRed);
    expect(cardInkColor(card("c", "spades"))).toBe(colors.cardInk);
  });

  it("builds the active suit model", () => {
    expect(formatSuitName("hearts")).toBe("Hearts");
    expect(getActiveSuitModel("hearts")).toEqual({
      suit: "hearts",
      symbol: "♥",
      name: "Hearts",
      color: colors.suitRedBright,
    });
    expect(getActiveSuitModel("clubs").color).toBe(colors.text);
  });
});

// ─── Zone display ──────────────────────────────────────────────────

describe("revealCards", () => {
  it("forces cards face-up when revealed and keeps identity otherwise", () => {
    const list = cards(2, false);
    expect(revealCards(list, false)).toBe(list);
    const revealed = revealCards(list, true);
    expect(revealed.every((c) => c.faceUp)).toBe(true);
    expect(list[0]!.faceUp).toBe(false);
  });

  it("keeps already face-up card objects", () => {
    const list = cards(1, true);
    expect(revealCards(list, true)[0]).toBe(list[0]);
  });
});

describe("getZoneDisplayMode", () => {
  const mode = (
    cardList: readonly Card[],
    opts: { name?: string; revealed?: boolean; expanded?: boolean } = {},
  ) =>
    getZoneDisplayMode({
      name: opts.name ?? "zone",
      cards: cardList,
      revealed: opts.revealed ?? false,
      expanded: opts.expanded ?? false,
    });

  it("is empty with no cards", () => {
    expect(mode([])).toBe("empty");
  });

  it("is discard for the discard pile", () => {
    expect(mode(cards(1, true), { name: "discard" })).toBe("discard");
  });

  it("collapses large face-down piles to a stack", () => {
    expect(mode(cards(7, false))).toBe("stack");
    expect(mode(cards(6, false))).toBe("fanned");
  });

  it("shows only the top card for large mixed piles until expanded", () => {
    const mixed = [...cards(6, false), card("up", "hearts", "K", true)];
    expect(mode(mixed)).toBe("top_only");
    expect(mode(mixed, { expanded: true })).toBe("fanned");
  });

  it("never collapses a revealed zone", () => {
    expect(mode(cards(9, false), { revealed: true })).toBe("fanned");
  });
});

describe("nextNewCardStartIndex", () => {
  it("marks the first added card", () => {
    expect(nextNewCardStartIndex(2, 5, -1)).toBe(2);
  });

  it("clears when cards are removed", () => {
    expect(nextNewCardStartIndex(5, 3, 2)).toBe(-1);
  });

  it("keeps the marker while the count is stable", () => {
    expect(nextNewCardStartIndex(5, 5, 2)).toBe(2);
  });
});

describe("getCappedCardList", () => {
  it("shows every card when under the cap", () => {
    const result = getCappedCardList(cards(3, true), -1);
    expect(result.hiddenCount).toBe(0);
    expect(result.cards.map((c) => c.isNew)).toEqual([false, false, false]);
  });

  it("hides the overflow and keeps the newest cards", () => {
    const list = cards(MAX_VISIBLE_CARDS + 2, true);
    const result = getCappedCardList(list, -1);
    expect(result.hiddenCount).toBe(2);
    expect(result.cards).toHaveLength(MAX_VISIBLE_CARDS);
    expect(result.cards[0]!.card.id).toBe("c2");
  });

  it("staggers newly dealt cards from the marker", () => {
    const result = getCappedCardList(cards(4, true), 2);
    expect(result.cards.map((c) => c.dealDelay)).toEqual([0, 0, 0, DEAL_STAGGER_MS]);
    expect(result.cards.map((c) => c.isNew)).toEqual([false, false, true, true]);
  });

  it("offsets the marker by the hidden count", () => {
    const list = cards(MAX_VISIBLE_CARDS + 1, true);
    const result = getCappedCardList(list, MAX_VISIBLE_CARDS);
    expect(result.cards.filter((c) => c.isNew)).toHaveLength(1);
    expect(result.cards.at(-1)!.dealDelay).toBe(0);
  });
});

// ─── Results overlay ───────────────────────────────────────────────

describe("results overlay", () => {
  const scored = engine({
    scores: {
      "player_score:0": 21,
      "player_score:1": 23,
      "result:0": 1,
      "result:1": -1,
      dealer_score: 19,
      house_edge_score: 2,
    },
  });

  it("builds per-player result rows", () => {
    expect(getPlayerResultRows(scored)).toEqual([
      {
        playerId: "p1",
        name: "Alice",
        handValue: 21,
        resultLabel: "WIN",
        resultColor: colors.success,
      },
      {
        playerId: "p2",
        name: "  bob",
        handValue: 23,
        resultLabel: "LOSS",
        resultColor: colors.redAlt,
      },
    ]);
  });

  it("defaults missing scores to a draw", () => {
    expect(getPlayerResultRows(engine())[0]).toMatchObject({
      handValue: 0,
      resultLabel: "DRAW",
      resultColor: colors.amber,
    });
  });

  it("humanizes NPC scores", () => {
    expect(getNpcScores(scored)).toEqual([
      { label: "Dealer", score: 19 },
      { label: "House Edge", score: 2 },
    ]);
  });

  it("resolves the winner name only when finished", () => {
    expect(resolveWinnerName(engine())).toBeNull();
    const finished = engine({
      status: { kind: "finished", finishedAt: 0, winnerId: "p2" as Player["id"] },
    });
    expect(resolveWinnerName(finished)).toBe("  bob");
    const draw = engine({ status: { kind: "finished", finishedAt: 0, winnerId: null } });
    expect(resolveWinnerName(draw)).toBeNull();
  });

  it("is null mid-game", () => {
    expect(getResultsOverlayModel(engine())).toBeNull();
  });

  it("prefers the round-end summary over game over", () => {
    const state = engine({
      currentPhase: "round_end",
      status: { kind: "finished", finishedAt: 0, winnerId: "p1" as Player["id"] },
    });
    expect(getResultsOverlayModel(state)?.kind).toBe("round_end");
  });

  it("returns the finished model with the winner", () => {
    const state = engine({
      status: { kind: "finished", finishedAt: 0, winnerId: "p1" as Player["id"] },
    });
    expect(getResultsOverlayModel(state)).toEqual({ kind: "finished", winnerName: "Alice" });
  });
});
