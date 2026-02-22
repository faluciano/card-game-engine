import { describe, it, expect } from "vitest";
import { SessionStore } from "./session-store.js";
import type { StoredSession } from "./session-store.js";
import type {
  CardGameState,
  CardGameRuleset,
  GameSessionId,
} from "@card-engine/shared";
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
  const transactionCalls: { sql: string; params?: unknown[] }[][] = [];
  let currentTxStatements: { sql: string; params?: unknown[] }[] | null = null;

  const execute = (sql: string, params?: unknown[]): MockExecuteResult => {
    const entry = { sql, params };
    if (currentTxStatements) {
      currentTxStatements.push(entry);
    } else {
      executed.push(entry);
    }
    return { rows: rowsToReturn, rowsAffected: rowsToReturn.length };
  };

  const transaction = (cb: (tx: { execute: typeof execute }) => void) => {
    currentTxStatements = [];
    cb({ execute });
    transactionCalls.push(currentTxStatements);
    currentTxStatements = null;
  };

  return { execute, transaction, executed, transactionCalls };
}

// ══════════════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════════════

function makeGameState(
  overrides: Partial<CardGameState> = {}
): CardGameState {
  return {
    sessionId: "test-session" as GameSessionId,
    ruleset: {} as CardGameRuleset,
    status: { kind: "in_progress", startedAt: 1000 },
    players: [],
    zones: {},
    currentPhase: "deal",
    currentPlayerIndex: 0,
    turnNumber: 1,
    scores: {},
    actionLog: [],
    version: 0,
    ...overrides,
  } as CardGameState;
}

/** Compress state the same way the source module does. */
function compressState(state: CardGameState): ArrayBuffer {
  const json = JSON.stringify(state);
  const compressed = pako.gzip(json);
  return compressed.buffer as ArrayBuffer;
}

/** Build a mock DB row that looks like a sessions table row. */
function makeSessionRow(
  overrides: Partial<{
    session_id: string;
    compressed_state: ArrayBuffer;
    saved_at: number;
  }> = {}
): Record<string, unknown> {
  const state = makeGameState();
  return {
    session_id: "test-session",
    compressed_state: compressState(state),
    saved_at: 2000,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("SessionStore", () => {
  // ── saveSnapshot ─────────────────────────────────────────────────

  describe("saveSnapshot", () => {
    it("executes INSERT OR REPLACE with correct params", async () => {
      const db = makeMockDb();
      const store = new SessionStore(db);
      const state = makeGameState();

      await store.saveSnapshot(state);

      expect(db.executed).toHaveLength(1);
      expect(db.executed[0]!.sql).toContain("INSERT OR REPLACE");
      expect(db.executed[0]!.sql).toContain("sessions");
      // Params: sessionId, blob, timestamp
      expect(db.executed[0]!.params?.[0]).toBe("test-session");
      expect(db.executed[0]!.params?.[1]).toBeInstanceOf(ArrayBuffer);
      expect(typeof db.executed[0]!.params?.[2]).toBe("number");
    });

    it("compresses state with pako", async () => {
      let capturedBlob: ArrayBuffer | undefined;
      const db = makeMockDb();
      const originalExecute = db.execute;
      db.execute = (sql: string, params?: unknown[]) => {
        if (params?.[1] instanceof ArrayBuffer) {
          capturedBlob = params[1];
        }
        return originalExecute(sql, params);
      };

      const store = new SessionStore(db);
      const state = makeGameState();

      await store.saveSnapshot(state);

      expect(capturedBlob).toBeDefined();
      const bytes = new Uint8Array(capturedBlob!);
      const json = pako.ungzip(bytes, { to: "string" });
      const decompressed = JSON.parse(json);
      expect(decompressed).toEqual(state);
    });

    it("uses state.sessionId as the primary key", async () => {
      const db = makeMockDb();
      const store = new SessionStore(db);
      const state = makeGameState({
        sessionId: "custom-session-id" as GameSessionId,
      });

      await store.saveSnapshot(state);

      expect(db.executed[0]!.params?.[0]).toBe("custom-session-id");
    });
  });

  // ── loadSnapshot ─────────────────────────────────────────────────

  describe("loadSnapshot", () => {
    it("returns decompressed state when found", async () => {
      const state = makeGameState();
      const row = makeSessionRow();
      const db = makeMockDb([row]);
      const store = new SessionStore(db);

      const result = await store.loadSnapshot(
        "test-session" as GameSessionId
      );

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("test-session");
      expect(result!.state).toEqual(state);
      expect(result!.savedAt).toBe(2000);
    });

    it("returns null when not found", async () => {
      const db = makeMockDb([]);
      const store = new SessionStore(db);

      const result = await store.loadSnapshot(
        "missing-session" as GameSessionId
      );

      expect(result).toBeNull();
    });

    it("compression round-trip: compressed state decompresses correctly", async () => {
      const state = makeGameState({
        turnNumber: 42,
        currentPhase: "scoring",
        version: 7,
      });
      const row = makeSessionRow({
        compressed_state: compressState(state),
      });
      const db = makeMockDb([row]);
      const store = new SessionStore(db);

      const result = await store.loadSnapshot(
        "test-session" as GameSessionId
      );

      expect(result!.state.turnNumber).toBe(42);
      expect(result!.state.currentPhase).toBe("scoring");
      expect(result!.state.version).toBe(7);
    });
  });

  // ── listSessions ─────────────────────────────────────────────────

  describe("listSessions", () => {
    it("returns empty array when no rows", async () => {
      const db = makeMockDb([]);
      const store = new SessionStore(db);

      const result = await store.listSessions();
      expect(result).toEqual([]);
    });

    it("returns sessions and executes ORDER BY saved_at DESC", async () => {
      const row1 = makeSessionRow({
        session_id: "session-1",
        saved_at: 3000,
      });
      const row2 = makeSessionRow({
        session_id: "session-2",
        saved_at: 2000,
      });
      const db = makeMockDb([row1, row2]);
      const store = new SessionStore(db);

      const result = await store.listSessions();

      expect(result).toHaveLength(2);
      expect(result[0]!.sessionId).toBe("session-1");
      expect(result[1]!.sessionId).toBe("session-2");
      expect(db.executed[0]!.sql).toContain("ORDER BY saved_at DESC");
    });
  });

  // ── deleteSession ────────────────────────────────────────────────

  describe("deleteSession", () => {
    it("uses transaction for cascade delete", async () => {
      const db = makeMockDb();
      const store = new SessionStore(db);

      await store.deleteSession("sess-1" as GameSessionId);

      expect(db.transactionCalls).toHaveLength(1);
    });

    it("deletes action_log entries first, then session", async () => {
      const db = makeMockDb();
      const store = new SessionStore(db);

      await store.deleteSession("sess-1" as GameSessionId);

      const tx = db.transactionCalls[0]!;
      expect(tx).toHaveLength(2);
      expect(tx[0]!.sql).toContain("DELETE FROM action_log");
      expect(tx[1]!.sql).toContain("DELETE FROM sessions");
    });

    it("passes sessionId to both DELETE statements", async () => {
      const db = makeMockDb();
      const store = new SessionStore(db);

      await store.deleteSession("sess-to-delete" as GameSessionId);

      const tx = db.transactionCalls[0]!;
      expect(tx[0]!.params).toEqual(["sess-to-delete"]);
      expect(tx[1]!.params).toEqual(["sess-to-delete"]);
    });
  });
});
