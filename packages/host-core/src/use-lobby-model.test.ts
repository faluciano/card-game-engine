import { describe, it, expect } from "vitest";
import {
  countConnected,
  formatPlayerCount,
  playerInitial,
  toPlayerList,
  type LobbyPlayer,
} from "./use-lobby-model";

function player(name: string, connected: boolean): LobbyPlayer {
  return { id: "stale", name, isHost: false, connected };
}

describe("toPlayerList", () => {
  it("keys each row by its record id, overriding a stale id field", () => {
    const list = toPlayerList({ a: player("Alice", true), b: player("Bob", false) });
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
    expect(list.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("is empty for no players", () => {
    expect(toPlayerList({})).toEqual([]);
  });
});

describe("countConnected", () => {
  it("counts only connected players", () => {
    expect(countConnected([player("a", true), player("b", false), player("c", true)])).toBe(2);
  });
});

describe("formatPlayerCount", () => {
  it("formats the count against the allowed range", () => {
    expect(formatPlayerCount(1, 2, 4)).toBe("1 / 2–4 players");
  });
});

describe("playerInitial", () => {
  it("upper-cases the first character", () => {
    expect(playerInitial(player("bob", true))).toBe("B");
  });

  it("is empty for an empty name", () => {
    expect(playerInitial(player("", true))).toBe("");
  });
});
