// ─── Session Store ─────────────────────────────────────────────────
// Persists game sessions for crash recovery and replay.
// Stores periodic state snapshots alongside the action log.

import type { DB } from "@op-engineering/op-sqlite";
import type { CardGameState, GameSessionId } from "@card-engine/shared";
import pako from "pako";

/** A persisted game session snapshot. */
export interface StoredSession {
  readonly sessionId: GameSessionId;
  readonly state: CardGameState;
  readonly savedAt: number;
}

// ─── Internal Helpers ──────────────────────────────────────────────

function compressState(state: CardGameState): ArrayBuffer {
  const json = JSON.stringify(state);
  const compressed = pako.gzip(json);
  return compressed.buffer as ArrayBuffer;
}

function decompressState(blob: ArrayBuffer): CardGameState {
  const bytes = new Uint8Array(blob);
  const json = pako.ungzip(bytes, { to: "string" });
  return JSON.parse(json) as CardGameState;
}

function rowToStoredSession(row: Record<string, unknown>): StoredSession {
  return {
    sessionId: row.session_id as GameSessionId,
    state: decompressState(row.compressed_state as ArrayBuffer),
    savedAt: row.saved_at as number,
  };
}

/**
 * Manages game session persistence in local SQLite.
 * Stores snapshots at key moments (phase transitions, every N actions).
 */
export class SessionStore {
  constructor(private readonly db: DB) {}

  async saveSnapshot(state: CardGameState): Promise<void> {
    const blob = compressState(state);
    const now = Date.now();

    // Upsert: insert or replace on conflict with the primary key
    this.db.execute(
      "INSERT OR REPLACE INTO sessions (session_id, compressed_state, saved_at) VALUES (?, ?, ?)",
      [state.sessionId, blob, now]
    );
  }

  async loadSnapshot(
    sessionId: GameSessionId
  ): Promise<StoredSession | null> {
    const result = this.db.execute(
      "SELECT session_id, compressed_state, saved_at FROM sessions WHERE session_id = ?",
      [sessionId]
    );

    if (result.rows.length === 0) return null;
    return rowToStoredSession(result.rows[0]!);
  }

  async listSessions(): Promise<readonly StoredSession[]> {
    const result = this.db.execute(
      "SELECT session_id, compressed_state, saved_at FROM sessions ORDER BY saved_at DESC"
    );

    return result.rows.map(rowToStoredSession);
  }

  async deleteSession(sessionId: GameSessionId): Promise<void> {
    this.db.transaction(
      (tx: { execute(sql: string, params?: unknown[]): void }) => {
        // Delete action log entries first (FK constraint)
        tx.execute("DELETE FROM action_log WHERE session_id = ?", [sessionId]);
        // Then delete the session itself
        tx.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId]);
      }
    );
  }
}
