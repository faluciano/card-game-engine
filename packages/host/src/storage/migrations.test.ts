import { describe, it, expect } from "vitest";
import { MIGRATIONS, runMigrations } from "./migrations.js";

// ══════════════════════════════════════════════════════════════════════
// Mock DB Factory
// ══════════════════════════════════════════════════════════════════════

interface MockExecuteResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
  insertId?: number;
}

function makeMigrationDb(currentVersion: number) {
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

    // Return max_version for the SELECT query
    if (sql.includes("MAX(version)")) {
      return { rows: [{ max_version: currentVersion }], rowsAffected: 0 };
    }
    return { rows: [], rowsAffected: 0 };
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
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("Migrations", () => {
  // ── MIGRATIONS constant ──────────────────────────────────────────

  describe("MIGRATIONS", () => {
    it("has exactly 3 migrations", () => {
      expect(MIGRATIONS).toHaveLength(3);
    });

    it("has versions 1, 2, and 3", () => {
      const versions = MIGRATIONS.map((m) => m.version);
      expect(versions).toEqual([1, 2, 3]);
    });

    it("each migration has version, description, and sql", () => {
      for (const migration of MIGRATIONS) {
        expect(migration).toHaveProperty("version");
        expect(migration).toHaveProperty("description");
        expect(migration).toHaveProperty("sql");
        expect(typeof migration.version).toBe("number");
        expect(typeof migration.description).toBe("string");
        expect(typeof migration.sql).toBe("string");
      }
    });

    it("versions are strictly ascending", () => {
      for (let i = 1; i < MIGRATIONS.length; i++) {
        expect(MIGRATIONS[i]!.version).toBeGreaterThan(
          MIGRATIONS[i - 1]!.version
        );
      }
    });
  });

  // ── runMigrations — fresh database ───────────────────────────────

  describe("runMigrations — fresh database", () => {
    it("creates the _migrations meta table", async () => {
      const db = makeMigrationDb(0);
      await runMigrations(db);

      const createMeta = db.executed.find((e) =>
        e.sql.includes("_migrations")
      );
      expect(createMeta).toBeDefined();
      expect(createMeta!.sql).toContain("CREATE TABLE IF NOT EXISTS");
    });

    it("queries current max version", async () => {
      const db = makeMigrationDb(0);
      await runMigrations(db);

      const selectMax = db.executed.find((e) =>
        e.sql.includes("MAX(version)")
      );
      expect(selectMax).toBeDefined();
    });

    it("applies all 3 migrations", async () => {
      const db = makeMigrationDb(0);
      await runMigrations(db);

      expect(db.transactionCalls).toHaveLength(3);
    });

    it("records each migration version in _migrations table", async () => {
      const db = makeMigrationDb(0);
      await runMigrations(db);

      for (let i = 0; i < 3; i++) {
        const tx = db.transactionCalls[i]!;
        const insertMigration = tx.find(
          (e) =>
            e.sql.includes("INSERT INTO _migrations") && e.params?.[0] === i + 1
        );
        expect(insertMigration).toBeDefined();
      }
    });

    it("wraps each migration in a transaction", async () => {
      const db = makeMigrationDb(0);
      await runMigrations(db);

      // Each transaction should have at least 2 statements:
      // the DDL + the INSERT INTO _migrations
      for (const tx of db.transactionCalls) {
        expect(tx.length).toBeGreaterThanOrEqual(2);
        const insertMigration = tx.find((e) =>
          e.sql.includes("INSERT INTO _migrations")
        );
        expect(insertMigration).toBeDefined();
      }
    });
  });

  // ── runMigrations — partially migrated ───────────────────────────

  describe("runMigrations — partially migrated (version 2)", () => {
    it("only applies migration 3", async () => {
      const db = makeMigrationDb(2);
      await runMigrations(db);

      expect(db.transactionCalls).toHaveLength(1);
    });

    it("skips migrations 1 and 2", async () => {
      const db = makeMigrationDb(2);
      await runMigrations(db);

      // The only transaction should record version 3
      const tx = db.transactionCalls[0]!;
      const insertMigration = tx.find((e) =>
        e.sql.includes("INSERT INTO _migrations")
      );
      expect(insertMigration).toBeDefined();
      expect(insertMigration!.params?.[0]).toBe(3);
    });
  });

  // ── runMigrations — fully migrated ───────────────────────────────

  describe("runMigrations — fully migrated (version 3)", () => {
    it("does not apply any migrations", async () => {
      const db = makeMigrationDb(3);
      await runMigrations(db);

      expect(db.transactionCalls).toHaveLength(0);
    });

    it("only executes meta table creation and version query", async () => {
      const db = makeMigrationDb(3);
      await runMigrations(db);

      // Should have exactly 2 top-level executions:
      // CREATE TABLE _migrations + SELECT MAX(version)
      expect(db.executed).toHaveLength(2);
      expect(db.executed[0]!.sql).toContain("CREATE TABLE IF NOT EXISTS");
      expect(db.executed[1]!.sql).toContain("MAX(version)");
    });
  });

  // ── Multi-statement SQL splitting ────────────────────────────────

  describe("multi-statement SQL splitting", () => {
    it("migration 3 contains two statements separated by semicolon", () => {
      const migration3 = MIGRATIONS.find((m) => m.version === 3)!;
      const statements = migration3.sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      expect(statements).toHaveLength(2);
    });

    it("executes both statements individually within the transaction", async () => {
      const db = makeMigrationDb(2); // Only migration 3 will run
      await runMigrations(db);

      const tx = db.transactionCalls[0]!;
      // Should have: statement 1 + statement 2 + INSERT INTO _migrations = 3
      expect(tx).toHaveLength(3);

      // First two are the DDL statements, last is the version record
      expect(tx[0]!.sql).toContain("CREATE TABLE");
      expect(tx[1]!.sql).toContain("CREATE INDEX");
      expect(tx[2]!.sql).toContain("INSERT INTO _migrations");
    });
  });
});
