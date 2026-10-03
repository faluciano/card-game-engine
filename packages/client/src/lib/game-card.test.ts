import { describe, it, expect } from "vitest";
import type { CatalogGame } from "@card-engine/shared";
import { getGameCardModel, type GameCardInput } from "./game-card.js";

const GAME: CatalogGame = {
  name: "Crazy Eights",
  slug: "crazy-eights",
  version: "2.0.0",
  author: "test",
  players: { min: 2, max: 4 },
  file: "rulesets/crazy-eights.cardgame.json",
};

const BASE: GameCardInput = {
  game: GAME,
  installedVersion: null,
  isBuiltIn: false,
  isPending: false,
  isUninstalling: false,
  isSelected: false,
  canSelect: false,
  canUninstall: true,
};

describe("getGameCardModel", () => {
  it("offers Get for a game that is not installed", () => {
    expect(getGameCardModel(BASE)).toEqual({
      primary: { kind: "get", label: "Get" },
      showRemove: false,
    });
  });

  it("shows Installed with Remove for an imported, up-to-date game", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "2.0.0" });
    expect(model.primary.kind).toBe("installed");
    expect(model.showRemove).toBe(true);
  });

  it("regression: never offers Remove on a built-in game", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "2.0.0", isBuiltIn: true });
    expect(model.primary.kind).toBe("installed");
    expect(model.showRemove).toBe(false);
  });

  it("offers Update when the installed version differs", () => {
    expect(getGameCardModel({ ...BASE, installedVersion: "1.0.0" })).toEqual({
      primary: { kind: "update", label: "Update" },
      showRemove: true,
    });
  });

  it("a built-in with an update offers Update but still no Remove", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "1.0.0", isBuiltIn: true });
    expect(model.primary.kind).toBe("update");
    expect(model.showRemove).toBe(false);
  });

  it("hides Remove when the context cannot uninstall", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "2.0.0", canUninstall: false });
    expect(model.showRemove).toBe(false);
  });

  it("in-flight install and uninstall take priority over everything else", () => {
    expect(
      getGameCardModel({ ...BASE, isPending: true, installedVersion: "1.0.0" }).primary.kind,
    ).toBe("installing");
    expect(
      getGameCardModel({
        ...BASE,
        isUninstalling: true,
        isPending: true,
        installedVersion: "2.0.0",
      }).primary.kind,
    ).toBe("removing");
  });

  it("offers Select for an installed game in the lobby", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "2.0.0", canSelect: true });
    expect(model.primary.kind).toBe("select");
    expect(model.showRemove).toBe(true);
  });

  it("shows Selected for the chosen lobby game", () => {
    const model = getGameCardModel({
      ...BASE,
      installedVersion: "2.0.0",
      canSelect: true,
      isSelected: true,
    });
    expect(model.primary.kind).toBe("selected");
    expect(model.showRemove).toBe(false);
  });

  it("shows Selected for the pinned lobby card, which has no Select handler", () => {
    const model = getGameCardModel({ ...BASE, installedVersion: "2.0.0", isSelected: true });
    expect(model.primary.kind).toBe("selected");
  });

  it("shows Selected even when the chosen game is missing from installedSlugs", () => {
    expect(getGameCardModel({ ...BASE, isSelected: true }).primary.kind).toBe("selected");
  });
});
