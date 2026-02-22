import { describe, it, expect, vi, beforeEach } from "vitest";
import { RulesetStore } from "./ruleset-store.js";
import type { StoredRuleset } from "./ruleset-store.js";
import type { CardGameRuleset } from "@card-engine/shared";
import pako from "pako";

// ══════════════════════════════════════════════════════════════════════
// Mock DB Factory
// ══════════════════════════════════════════════════════════════════════

interface MockExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  insertId?: number;
}

function makeMockDb(rowsToReturn: Record<string, unknown>[] = []) {
  const executed: { sql: string; params?: unknown[] }[] = [];

  const execute = (sql: string, params?: unknown[]): MockExecuteResult => {
    executed.push({ sql, params });
    return { rows: rowsToReturn, rowsAffected: rowsToReturn.length };
  };

  const transaction = (cb: (tx: { execute: typeof execute }) => void) => {
    cb({ execute });
  };

  return { execute, transaction, executed };
}

// ══════════════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════════════

function makeMinimalRuleset(): CardGameRuleset {
  return {
    meta: {
      slug: "test-game",
      name: "Test Game",
      version: "1.0.0",
      minPlayers: 2,
      maxPlayers: 4,
    },
    deck: { preset: "standard52" },
    roles: [{ name: "player", isHuman: true, count: 1 }],
    zones: [
      {
        name: "hand",
        owner: "player",
        visibility: { kind: "owner_only" },
      },
    ],
    phases: [
      {
        name: "play",
        kind: "turn_based",
        actions: [],
        transitions: [{ to: "play", when: "true" }],
      },
    ],
    scoring: { method: "manual" },
  } as unknown as CardGameRuleset;
}

/** Compress data the same way the source module does. */
function compressRuleset(ruleset: CardGameRuleset): ArrayBuffer {
  const json = JSON.stringify(ruleset);
  const compressed = pako.gzip(json);
  return compressed.buffer as ArrayBuffer;
}

/** Build a mock DB row that looks like a rulesets table row. */
function makeRulesetRow(
  overrides: Partial<{
    id: string;
    slug: string;
    compressed_data: ArrayBuffer;
    imported_at: number;
    last_played_at: number | null;
  }> = {}
): Record<string, unknown> {
  const ruleset = makeMinimalRuleset();
  return {
    id: "row-id-1",
    slug: "test-game",
    compressed_data: compressRuleset(ruleset),
    imported_at: 1000,
    last_played_at: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("RulesetStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── list ──────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns empty array when no rows", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      const result = await store.list();
      expect(result).toEqual([]);
    });

    it("returns StoredRuleset array with decompressed data", async () => {
      const row = makeRulesetRow();
      const db = makeMockDb([row]);
      const store = new RulesetStore(db);

      const result = await store.list();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("row-id-1");
      expect(result[0]!.ruleset).toEqual(makeMinimalRuleset());
      expect(result[0]!.importedAt).toBe(1000);
      expect(result[0]!.lastPlayedAt).toBeNull();
    });

    it("executes correct SQL with ORDER BY", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      await store.list();

      expect(db.executed).toHaveLength(1);
      expect(db.executed[0]!.sql).toContain("SELECT");
      expect(db.executed[0]!.sql).toContain("ORDER BY imported_at DESC");
    });
  });

  // ── getById ──────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns decompressed ruleset when found", async () => {
      const row = makeRulesetRow({ id: "found-id" });
      const db = makeMockDb([row]);
      const store = new RulesetStore(db);

      const result = await store.getById("found-id");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("found-id");
      expect(result!.ruleset).toEqual(makeMinimalRuleset());
    });

    it("returns null when not found", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      const result = await store.getById("missing-id");
      expect(result).toBeNull();
    });

    it("returns null without executing SQL when id is empty", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      const result = await store.getById("");
      expect(result).toBeNull();
      expect(db.executed).toHaveLength(0);
    });
  });

  // ── save ─────────────────────────────────────────────────────────

  describe("save", () => {
    it("stores compressed blob with correct SQL", async () => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue(
        "mock-uuid-1234" as ReturnType<typeof crypto.randomUUID>
      );
      const db = makeMockDb([]);
      const store = new RulesetStore(db);
      const ruleset = makeMinimalRuleset();

      await store.save(ruleset);

      expect(db.executed).toHaveLength(1);
      expect(db.executed[0]!.sql).toContain("INSERT INTO rulesets");
      expect(db.executed[0]!.params?.[0]).toBe("mock-uuid-1234");
      expect(db.executed[0]!.params?.[1]).toBe("test-game");
      // Third param is the compressed blob (ArrayBuffer)
      expect(db.executed[0]!.params?.[2]).toBeInstanceOf(ArrayBuffer);
    });

    it("returns StoredRuleset with generated id", async () => {
      vi.spyOn(crypto, "randomUUID").mockReturnValue(
        "mock-uuid-5678" as ReturnType<typeof crypto.randomUUID>
      );
      const db = makeMockDb([]);
      const store = new RulesetStore(db);
      const ruleset = makeMinimalRuleset();

      const result = await store.save(ruleset);

      expect(result.id).toBe("mock-uuid-5678");
      expect(result.ruleset).toEqual(ruleset);
      expect(result.lastPlayedAt).toBeNull();
      expect(typeof result.importedAt).toBe("number");
    });

    it("compression round-trip produces the same ruleset", async () => {
      // Capture the blob written by save, then decompress it
      let capturedBlob: ArrayBuffer | undefined;
      const db = makeMockDb([]);
      const originalExecute = db.execute;
      db.execute = (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT") && params?.[2] instanceof ArrayBuffer) {
          capturedBlob = params[2];
        }
        return originalExecute(sql, params);
      };

      const store = new RulesetStore(db);
      const ruleset = makeMinimalRuleset();

      await store.save(ruleset);

      expect(capturedBlob).toBeDefined();
      const bytes = new Uint8Array(capturedBlob!);
      const json = pako.ungzip(bytes, { to: "string" });
      const decompressed = JSON.parse(json);
      expect(decompressed).toEqual(ruleset);
    });

    it("extracts slug from ruleset.meta.slug", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);
      const ruleset = makeMinimalRuleset();

      await store.save(ruleset);

      // slug is the second param
      expect(db.executed[0]!.params?.[1]).toBe("test-game");
    });
  });

  // ── delete ───────────────────────────────────────────────────────

  describe("delete", () => {
    it("executes DELETE SQL with correct id", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      await store.delete("delete-me");

      expect(db.executed).toHaveLength(1);
      expect(db.executed[0]!.sql).toContain("DELETE FROM rulesets");
      expect(db.executed[0]!.params).toEqual(["delete-me"]);
    });

    it("returns without executing SQL when id is empty", async () => {
      const db = makeMockDb([]);
      const store = new RulesetStore(db);

      await store.delete("");

      expect(db.executed).toHaveLength(0);
    });
  });
});
