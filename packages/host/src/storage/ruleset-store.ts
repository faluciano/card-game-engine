// ─── Ruleset Store ─────────────────────────────────────────────────
// CRUD operations for rulesets stored locally on the host device.
// Uses pako for gzip compression of JSON blobs in SQLite.

import type { CardGameRuleset } from "@card-engine/shared";

/** A stored ruleset with metadata for the local database. */
export interface StoredRuleset {
  readonly id: string;
  readonly ruleset: CardGameRuleset;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

/**
 * Manages ruleset persistence in local SQLite via op-sqlite.
 * Rulesets are gzip-compressed with pako before storage.
 */
export class RulesetStore {
  // TODO: Accept op-sqlite database instance in constructor
  // TODO: Implement CRUD with pako compression/decompression

  async list(): Promise<readonly StoredRuleset[]> {
    // TODO: SELECT all, decompress, parse, return
    throw new Error("Not implemented: RulesetStore.list");
  }

  async getById(id: string): Promise<StoredRuleset | null> {
    if (!id) return null;
    // TODO: SELECT by id, decompress, parse, return
    throw new Error("Not implemented: RulesetStore.getById");
  }

  async save(ruleset: CardGameRuleset): Promise<StoredRuleset> {
    // TODO: Serialize, compress with pako, INSERT into SQLite
    throw new Error("Not implemented: RulesetStore.save");
  }

  async delete(id: string): Promise<void> {
    if (!id) return;
    // TODO: DELETE by id
    throw new Error("Not implemented: RulesetStore.delete");
  }
}
