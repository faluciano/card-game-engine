// ─── SQLite Migrations ─────────────────────────────────────────────
// Schema migrations for the host's local SQLite database.
// Each migration is idempotent and versioned.

import type { DB } from "@op-engineering/op-sqlite";

/** A single migration step. */
export interface Migration {
  readonly version: number;
  readonly description: string;
  readonly sql: string;
}

/** All migrations in order. Add new migrations at the end. */
export const MIGRATIONS: readonly Migration[] = [
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
 * Tracks applied migrations in a `_migrations` meta table.
 *
 * @param db - An op-sqlite database instance.
 */
export async function runMigrations(db: DB): Promise<void> {
  // Ensure meta table exists
  db.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );

  // Query current max version (0 if no migrations applied yet)
  const result = db.execute("SELECT MAX(version) AS max_version FROM _migrations");
  const currentVersion =
    (result.rows?.[0]?.max_version as number | null) ?? 0;

  // Apply each pending migration in order
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    db.transaction((tx: { execute(sql: string, params?: unknown[]): void }) => {
      // Migration SQL may contain multiple statements separated by semicolons.
      // op-sqlite's execute handles one statement at a time, so split them.
      const statements = migration.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        tx.execute(statement);
      }

      tx.execute("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [
        migration.version,
        Date.now(),
      ]);
    });
  }
}
