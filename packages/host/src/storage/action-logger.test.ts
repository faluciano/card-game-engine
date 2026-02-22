import { describe, it, expect } from "vitest";
import { ActionLogger } from "./action-logger";
import type {
  CardGameAction,
  GameSessionId,
  ResolvedAction,
} from "@card-engine/shared";

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

function makeResolvedAction(
  overrides: Partial<ResolvedAction> = {}
): ResolvedAction {
  return {
    action: { kind: "start_game" } as CardGameAction,
    timestamp: Date.now(),
    version: 1,
    ...overrides,
  };
}

/** Build a mock DB row that looks like an action_log table row. */
function makeActionRow(
  overrides: Partial<{
    version: number;
    action_json: string;
    timestamp: number;
  }> = {}
): Record<string, unknown> {
  return {
    version: 1,
    action_json: JSON.stringify({ kind: "start_game" }),
    timestamp: 1000,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("ActionLogger", () => {
  // ── append ───────────────────────────────────────────────────────

  describe("append", () => {
    it("executes INSERT with correct SQL", async () => {
      const db = makeMockDb();
      const logger = new ActionLogger(db);
      const action = makeResolvedAction();

      await logger.append("sess-1" as GameSessionId, action);

      expect(db.executed).toHaveLength(1);
      expect(db.executed[0]!.sql).toContain("INSERT INTO action_log");
      expect(db.executed[0]!.sql).toContain(
        "session_id, version, action_json, timestamp"
      );
    });

    it("serializes action.action as JSON string", async () => {
      const db = makeMockDb();
      const logger = new ActionLogger(db);
      const action = makeResolvedAction({
        action: { kind: "start_game" } as CardGameAction,
      });

      await logger.append("sess-1" as GameSessionId, action);

      // action_json is the third param (index 2)
      const actionJson = db.executed[0]!.params?.[2] as string;
      expect(typeof actionJson).toBe("string");
      expect(JSON.parse(actionJson)).toEqual({ kind: "start_game" });
    });

    it("passes version and timestamp from ResolvedAction", async () => {
      const db = makeMockDb();
      const logger = new ActionLogger(db);
      const action = makeResolvedAction({ version: 5, timestamp: 9999 });

      await logger.append("sess-1" as GameSessionId, action);

      const params = db.executed[0]!.params!;
      expect(params[0]).toBe("sess-1"); // session_id
      expect(params[1]).toBe(5); // version
      expect(params[3]).toBe(9999); // timestamp
    });
  });

  // ── getActions ───────────────────────────────────────────────────

  describe("getActions", () => {
    it("without fromVersion: returns all actions ordered by version ASC", async () => {
      const rows = [
        makeActionRow({ version: 1, timestamp: 1000 }),
        makeActionRow({
          version: 2,
          action_json: JSON.stringify({ kind: "advance_phase" }),
          timestamp: 2000,
        }),
      ];
      const db = makeMockDb(rows);
      const logger = new ActionLogger(db);

      const result = await logger.getActions("sess-1" as GameSessionId);

      expect(result).toHaveLength(2);
      expect(db.executed[0]!.sql).toContain("ORDER BY version ASC");
      expect(db.executed[0]!.sql).not.toContain("version >=");
      expect(db.executed[0]!.params).toEqual(["sess-1"]);
    });

    it("with fromVersion: adds version filter to SQL", async () => {
      const db = makeMockDb([]);
      const logger = new ActionLogger(db);

      await logger.getActions("sess-1" as GameSessionId, 3);

      expect(db.executed[0]!.sql).toContain("version >=");
      expect(db.executed[0]!.sql).toContain("ORDER BY version ASC");
      expect(db.executed[0]!.params).toEqual(["sess-1", 3]);
    });

    it("returns empty array when no rows match", async () => {
      const db = makeMockDb([]);
      const logger = new ActionLogger(db);

      const result = await logger.getActions("sess-1" as GameSessionId);

      expect(result).toEqual([]);
    });

    it("deserializes action_json back to CardGameAction", async () => {
      const complexAction: CardGameAction = {
        kind: "draw_card",
        playerId: "p1",
        fromZone: "deck",
        toZone: "hand",
        count: 2,
      } as unknown as CardGameAction;

      const rows = [
        makeActionRow({
          version: 1,
          action_json: JSON.stringify(complexAction),
          timestamp: 5000,
        }),
      ];
      const db = makeMockDb(rows);
      const logger = new ActionLogger(db);

      const result = await logger.getActions("sess-1" as GameSessionId);

      expect(result).toHaveLength(1);
      expect(result[0]!.action).toEqual(complexAction);
      expect(result[0]!.version).toBe(1);
      expect(result[0]!.timestamp).toBe(5000);
    });
  });

  // ── getActionCount ───────────────────────────────────────────────

  describe("getActionCount", () => {
    it("returns count from SELECT COUNT(*)", async () => {
      const db = makeMockDb([{ count: 42 }]);
      const logger = new ActionLogger(db);

      const result = await logger.getActionCount("sess-1" as GameSessionId);

      expect(result).toBe(42);
      expect(db.executed[0]!.sql).toContain("COUNT(*)");
      expect(db.executed[0]!.params).toEqual(["sess-1"]);
    });

    it("returns 0 when no rows match", async () => {
      // When the session doesn't exist, the COUNT query still returns a row
      // with count = 0, but we test the fallback ?? 0 path as well
      const db = makeMockDb([{ count: 0 }]);
      const logger = new ActionLogger(db);

      const result = await logger.getActionCount(
        "empty-session" as GameSessionId
      );

      expect(result).toBe(0);
    });
  });
});
