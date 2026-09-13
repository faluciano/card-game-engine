import { describe, it, expect, vi, afterEach } from "vitest";
import type { CardGameRuleset, CatalogGame } from "@card-engine/shared";
import type { StoredRuleset } from "./ruleset-store";
import {
  buildRulesetItems,
  fetchCatalogRuleset,
  findInstalledVersion,
  formatInstallError,
  formatPlayerRange,
  getStoreActions,
} from "./ruleset-picker-model";
import { BUILT_IN_RULESETS } from "./built-in-rulesets";
import { CATALOG_BASE_URL } from "./use-catalog";

// ─── Fixtures ──────────────────────────────────────────────────────

function ruleset(slug: string): CardGameRuleset {
  return { meta: { slug, name: slug, version: "1.0.0" } } as unknown as CardGameRuleset;
}

function stored(id: string, slug: string): StoredRuleset {
  return { id, ruleset: ruleset(slug), importedAt: 0, lastPlayedAt: null };
}

const game: CatalogGame = {
  slug: "war",
  name: "War",
  version: "2.0.0",
  author: "a",
  players: { min: 2, max: 2 },
  file: "rulesets/war.cardgame.json",
} as CatalogGame;

const noop = (): void => {};

// ─── Library ───────────────────────────────────────────────────────

describe("buildRulesetItems", () => {
  it("lists built-ins first with stable keys", () => {
    const items = buildRulesetItems([ruleset("a"), ruleset("b")], [stored("id-1", "c")]);
    expect(items.map((i) => i.key)).toEqual(["builtin:a", "builtin:b", "id-1"]);
    expect(items.map((i) => i.source)).toEqual(["built_in", "built_in", "imported"]);
    expect(items[0]!.id).toBeNull();
    expect(items[2]!.id).toBe("id-1");
  });

  it("is empty without inputs", () => {
    expect(buildRulesetItems([], [])).toEqual([]);
  });
});

describe("formatPlayerRange", () => {
  it("collapses equal bounds", () => {
    expect(formatPlayerRange({ min: 2, max: 2 })).toBe("2 players");
  });

  it("uses an en dash for ranges", () => {
    expect(formatPlayerRange({ min: 2, max: 6 })).toBe("2–6 players");
  });
});

// ─── Store ─────────────────────────────────────────────────────────

describe("getStoreActions", () => {
  const base = { game, isBuiltIn: false, installing: false, onInstall: noop, onUninstall: noop };

  it("shows a spinner label while installing", () => {
    const actions = getStoreActions({ ...base, installedVersion: null, installing: true });
    expect(actions).toEqual([{ label: "...", variant: "disabled" }]);
  });

  it("offers GET when not installed", () => {
    const actions = getStoreActions({ ...base, installedVersion: null });
    expect(actions.map((a) => a.label)).toEqual(["GET"]);
    expect(actions[0]!.onPress).toBe(noop);
  });

  it("offers REMOVE for an up-to-date imported game", () => {
    const actions = getStoreActions({ ...base, installedVersion: "2.0.0" });
    expect(actions.map((a) => [a.label, a.variant])).toEqual([["REMOVE", "danger"]]);
  });

  it("offers UPDATE and REMOVE for an outdated imported game", () => {
    const actions = getStoreActions({ ...base, installedVersion: "1.0.0" });
    expect(actions.map((a) => a.label)).toEqual(["UPDATE", "REMOVE"]);
  });

  it("marks an up-to-date built-in as BUILT-IN", () => {
    const actions = getStoreActions({ ...base, installedVersion: "2.0.0", isBuiltIn: true });
    expect(actions).toEqual([{ label: "BUILT-IN", variant: "disabled" }]);
  });

  it("offers only UPDATE for an outdated built-in", () => {
    const actions = getStoreActions({ ...base, installedVersion: "1.0.0", isBuiltIn: true });
    expect(actions.map((a) => a.label)).toEqual(["UPDATE"]);
  });
});

describe("findInstalledVersion", () => {
  it("returns the version when installed", () => {
    expect(findInstalledVersion([{ slug: "war", version: "1.2.3" }], "war")).toBe("1.2.3");
  });

  it("returns null when not installed", () => {
    expect(findInstalledVersion([{ slug: "war", version: "1.2.3" }], "blackjack")).toBeNull();
  });
});

describe("formatInstallError", () => {
  it("includes the error message", () => {
    expect(formatInstallError(game, new Error("HTTP 500"))).toBe("Could not install War: HTTP 500");
  });

  it("falls back for non-Error throwables", () => {
    expect(formatInstallError(game, "boom")).toBe("Could not install War: Install failed");
  });
});

describe("fetchCatalogRuleset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the catalog file and returns the parsed ruleset", async () => {
    const valid = BUILT_IN_RULESETS[0]!;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => valid }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCatalogRuleset(game);
    expect(fetchMock).toHaveBeenCalledWith(`${CATALOG_BASE_URL}${game.file}`);
    expect(result.meta.slug).toBe(valid.meta.slug);
  });

  it("throws on an HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    await expect(fetchCatalogRuleset(game)).rejects.toThrow("HTTP 404");
  });

  it("throws when the payload is not a ruleset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) })),
    );
    await expect(fetchCatalogRuleset(game)).rejects.toThrow("Invalid ruleset format");
  });
});
