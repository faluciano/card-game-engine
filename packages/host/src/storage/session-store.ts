// ─── Session Store ─────────────────────────────────────────────────
// Persists game sessions for crash recovery and replay.
// Stores periodic state snapshots alongside the action log.

import type { CardGameState, GameSessionId } from "@card-engine/shared";

/** A persisted game session snapshot. */
export interface StoredSession {
  readonly sessionId: GameSessionId;
  readonly state: CardGameState;
  readonly savedAt: number;
}

/**
 * Manages game session persistence in local SQLite.
 * Stores snapshots at key moments (phase transitions, every N actions).
 */
export class SessionStore {
  // TODO: Accept op-sqlite database instance in constructor

  async saveSnapshot(state: CardGameState): Promise<void> {
    // TODO: Serialize state, compress, upsert into SQLite
    throw new Error("Not implemented: SessionStore.saveSnapshot");
  }

  async loadSnapshot(
    sessionId: GameSessionId
  ): Promise<StoredSession | null> {
    // TODO: SELECT by sessionId, decompress, parse, return
    throw new Error("Not implemented: SessionStore.loadSnapshot");
  }

  async listSessions(): Promise<readonly StoredSession[]> {
    // TODO: SELECT all sessions ordered by savedAt desc
    throw new Error("Not implemented: SessionStore.listSessions");
  }

  async deleteSession(sessionId: GameSessionId): Promise<void> {
    // TODO: DELETE session and its action log entries
    throw new Error("Not implemented: SessionStore.deleteSession");
  }
}
