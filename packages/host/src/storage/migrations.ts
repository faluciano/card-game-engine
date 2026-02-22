// ─── SQLite Migrations ─────────────────────────────────────────────
// Schema migrations for the host's local SQLite database.
// Each migration is idempotent and versioned.

/** A single migration step. */
interface Migration {
  readonly version: number;
  readonly description: string;
  readonly sql: string;
}

/** All migrations in order. Add new migrations at the end. */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: "Create rulesets table",
    sql: `
      CREATE TABLE IF NOT EXISTS rulesets (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        compressed_data BLOB NOT NULL,
        imported_at INTEGER NOT NULL,
        last_played_at INTEGER
      );
    `,
  },
  {
    version: 2,
    description: "Create sessions table",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        compressed_state BLOB NOT NULL,
        saved_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    description: "Create action log table",
    sql: `
      CREATE TABLE IF NOT EXISTS action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        action_json TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_action_log_session
        ON action_log(session_id, version);
    `,
  },
];

/**
 * Runs all pending migrations against the database.
 * Tracks applied migrations in a meta table.
 *
 * @param db - An op-sqlite database instance.
 */
export async function runMigrations(db: unknown): Promise<void> {
  // TODO: Create migrations meta table if not exists
  // TODO: Query current version
  // TODO: Apply each migration > current version in order
  // TODO: Update meta table after each successful migration
  throw new Error("Not implemented: runMigrations");
}
