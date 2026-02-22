// ─── Ruleset Store ─────────────────────────────────────────────────
// CRUD operations for rulesets stored locally on the host device.
// Uses pako for gzip compression of JSON blobs in SQLite.

import type { DB } from "@op-engineering/op-sqlite";
import type { CardGameRuleset } from "@card-engine/shared";
import pako from "pako";

/** A stored ruleset with metadata for the local database. */
export interface StoredRuleset {
  readonly id: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

// ─── Internal Helpers ──────────────────────────────────────────────

function compress(data: unknown): ArrayBuffer {
  const json = JSON.stringify(data);
  const compressed = pako.gzip(json);
  // op-sqlite expects ArrayBuffer for BLOB columns
  return compressed.buffer as ArrayBuffer;
}

function decompress(blob: ArrayBuffer): unknown {
  const bytes = new Uint8Array(blob);
  const json = pako.ungzip(bytes, { to: "string" });
  return JSON.parse(json);
}

function rowToStoredRuleset(row: Record<string, unknown>): StoredRuleset {
  return {
    id: row.id as string,
    ruleset: decompress(row.compressed_data as ArrayBuffer) as CardGameRuleset,
    importedAt: row.imported_at as number,
    lastPlayedAt: (row.last_played_at as number | null) ?? null,
  };
}

/**
 * Manages ruleset persistence in local SQLite via op-sqlite.
 * Rulesets are gzip-compressed with pako before storage.
 */
export class RulesetStore {
  constructor(private readonly db: DB) {}

  async list(): Promise<readonly StoredRuleset[]> {
    const result = this.db.execute(
      "SELECT id, slug, compressed_data, imported_at, last_played_at FROM rulesets ORDER BY imported_at DESC"
    );

    return result.rows.map(rowToStoredRuleset);
  }

  async getById(id: string): Promise<StoredRuleset | null> {
    if (!id) return null;

    const result = this.db.execute(
      "SELECT id, slug, compressed_data, imported_at, last_played_at FROM rulesets WHERE id = ?",
      [id]
    );

    if (result.rows.length === 0) return null;
    return rowToStoredRuleset(result.rows[0]!);
  }

  async save(ruleset: CardGameRuleset): Promise<StoredRuleset> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const blob = compress(ruleset);

    this.db.execute(
      "INSERT INTO rulesets (id, slug, compressed_data, imported_at, last_played_at) VALUES (?, ?, ?, ?, NULL)",
      [id, ruleset.meta.slug, blob, now]
    );

    return {
      id,
      ruleset,
      importedAt: now,
      lastPlayedAt: null,
    };
  }

  async delete(id: string): Promise<void> {
    if (!id) return;

    this.db.execute("DELETE FROM rulesets WHERE id = ?", [id]);
  }
}
