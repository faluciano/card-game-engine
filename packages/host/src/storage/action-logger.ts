// ─── Action Logger ─────────────────────────────────────────────────
// Append-only log of all game actions for a session.
// Enables replay, undo, and audit trail functionality.

import type { DB } from "@op-engineering/op-sqlite";
import type {
  CardGameAction,
  GameSessionId,
  ResolvedAction,
} from "@card-engine/shared";

// ─── Internal Helpers ──────────────────────────────────────────────

function rowToResolvedAction(row: Record<string, unknown>): ResolvedAction {
  return {
    action: JSON.parse(row.action_json as string) as CardGameAction,
    timestamp: row.timestamp as number,
    version: row.version as number,
  };
}

/**
 * Append-only action log stored in SQLite.
 * Actions are never modified or deleted during a game.
 */
export class ActionLogger {
  constructor(private readonly db: DB) {}

  async append(
    sessionId: GameSessionId,
    action: ResolvedAction
  ): Promise<void> {
    this.db.execute(
      "INSERT INTO action_log (session_id, version, action_json, timestamp) VALUES (?, ?, ?, ?)",
      [
        sessionId,
        action.version,
        JSON.stringify(action.action),
        action.timestamp,
      ]
    );
  }

  async getActions(
    sessionId: GameSessionId,
    fromVersion?: number
  ): Promise<readonly ResolvedAction[]> {
    const result =
      fromVersion !== undefined
        ? this.db.execute(
            "SELECT version, action_json, timestamp FROM action_log WHERE session_id = ? AND version >= ? ORDER BY version ASC",
            [sessionId, fromVersion]
          )
        : this.db.execute(
            "SELECT version, action_json, timestamp FROM action_log WHERE session_id = ? ORDER BY version ASC",
            [sessionId]
          );

    return result.rows.map(rowToResolvedAction);
  }

  async getActionCount(sessionId: GameSessionId): Promise<number> {
    const result = this.db.execute(
      "SELECT COUNT(*) AS count FROM action_log WHERE session_id = ?",
      [sessionId]
    );

    return (result.rows[0]?.count as number) ?? 0;
  }
}
