// ─── Action Logger ─────────────────────────────────────────────────
// Append-only log of all game actions for a session.
// Enables replay, undo, and audit trail functionality.

import type {
  CardGameAction,
  GameSessionId,
  ResolvedAction,
} from "@card-engine/shared";

/**
 * Append-only action log stored in SQLite.
 * Actions are never modified or deleted during a game.
 */
export class ActionLogger {
  // TODO: Accept op-sqlite database instance in constructor

  async append(
    sessionId: GameSessionId,
    action: ResolvedAction
  ): Promise<void> {
    // TODO: INSERT action with sessionId, timestamp, version
    throw new Error("Not implemented: ActionLogger.append");
  }

  async getActions(
    sessionId: GameSessionId,
    fromVersion?: number
  ): Promise<readonly ResolvedAction[]> {
    // TODO: SELECT actions for session, optionally from a version
    throw new Error("Not implemented: ActionLogger.getActions");
  }

  async getActionCount(sessionId: GameSessionId): Promise<number> {
    // TODO: SELECT COUNT(*) for session
    throw new Error("Not implemented: ActionLogger.getActionCount");
  }
}
