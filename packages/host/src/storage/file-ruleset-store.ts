// ─── File Ruleset Store ────────────────────────────────────────────
// CRUD operations for rulesets stored as JSON files on the device.
// Uses expo-file-system instead of SQLite for zero native-dependency simplicity.

import * as FileSystem from "expo-file-system";
import type { CardGameRuleset } from "@card-engine/shared";
import type { StoredRuleset } from "./ruleset-store";

// Re-export StoredRuleset so consumers don't need to import from two files
export type { StoredRuleset } from "./ruleset-store";

const RULESETS_DIR = `${FileSystem.documentDirectory}rulesets/`;
const METADATA_PATH = `${RULESETS_DIR}_metadata.json`;

/** Metadata for a single stored ruleset (everything except the ruleset itself). */
interface RulesetMetadataEntry {
  readonly slug: string;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

/** The full metadata index: id -> entry. */
type MetadataIndex = Record<string, RulesetMetadataEntry>;

// ─── Internal Helpers ──────────────────────────────────────────────

function generateId(): string {
  // crypto.randomUUID may not be available on Hermes
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: Math.random-based UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function rulesetFilePath(id: string): string {
  return `${RULESETS_DIR}${id}.cardgame.json`;
}

// ─── File Ruleset Store ────────────────────────────────────────────

/**
 * Manages ruleset persistence using the device file system.
 *
 * Storage layout:
 * ```
 * ${documentDirectory}rulesets/
 * ├── _metadata.json          <- { [id]: { slug, importedAt, lastPlayedAt } }
 * ├── {id}.cardgame.json      <- raw ruleset JSON
 * ```
 */
export class FileRulesetStore {
  /** Creates the rulesets directory if it doesn't exist. */
  private async ensureDirectory(): Promise<void> {
    await FileSystem.makeDirectoryAsync(RULESETS_DIR, { intermediates: true });
  }

  /** Reads and parses the metadata index. Returns `{}` on missing or corrupt file. */
  private async readMetadata(): Promise<MetadataIndex> {
    const info = await FileSystem.getInfoAsync(METADATA_PATH);
    if (!info.exists) return {};

    try {
      const raw = await FileSystem.readAsStringAsync(METADATA_PATH);
      return JSON.parse(raw) as MetadataIndex;
    } catch {
      return {};
    }
  }

  /** Writes the metadata index to disk. */
  private async writeMetadata(index: MetadataIndex): Promise<void> {
    await FileSystem.writeAsStringAsync(
      METADATA_PATH,
      JSON.stringify(index, null, 2),
    );
  }

  /** Lists all stored rulesets, sorted by importedAt descending. */
  async list(): Promise<readonly StoredRuleset[]> {
    await this.ensureDirectory();

    const index = await this.readMetadata();
    const entries = Object.entries(index);
    const results: StoredRuleset[] = [];

    for (const [id, meta] of entries) {
      try {
        const raw = await FileSystem.readAsStringAsync(rulesetFilePath(id));
        const ruleset = JSON.parse(raw) as CardGameRuleset;

        results.push({
          id,
          ruleset,
          importedAt: meta.importedAt,
          lastPlayedAt: meta.lastPlayedAt,
        });
      } catch {
        // Skip entries with missing or corrupt ruleset files
        continue;
      }
    }

    // Sort by importedAt descending (most recent first)
    results.sort((a, b) => b.importedAt - a.importedAt);

    return results;
  }

  /** Returns a single stored ruleset by ID, or null if not found. */
  async getById(id: string): Promise<StoredRuleset | null> {
    if (!id) return null;

    await this.ensureDirectory();

    const index = await this.readMetadata();
    const meta = index[id];
    if (!meta) return null;

    try {
      const raw = await FileSystem.readAsStringAsync(rulesetFilePath(id));
      const ruleset = JSON.parse(raw) as CardGameRuleset;

      return {
        id,
        ruleset,
        importedAt: meta.importedAt,
        lastPlayedAt: meta.lastPlayedAt,
      };
    } catch {
      return null;
    }
  }

  /** Saves a new ruleset to the store. Returns the stored entry. */
  async save(ruleset: CardGameRuleset): Promise<StoredRuleset> {
    await this.ensureDirectory();

    const id = generateId();
    const now = Date.now();

    // Write the ruleset file
    await FileSystem.writeAsStringAsync(
      rulesetFilePath(id),
      JSON.stringify(ruleset, null, 2),
    );

    // Update metadata index
    const index = await this.readMetadata();
    index[id] = {
      slug: ruleset.meta.slug,
      importedAt: now,
      lastPlayedAt: null,
    };
    await this.writeMetadata(index);

    return {
      id,
      ruleset,
      importedAt: now,
      lastPlayedAt: null,
    };
  }

  /** Deletes a stored ruleset by ID. */
  async delete(id: string): Promise<void> {
    if (!id) return;

    await this.ensureDirectory();

    // Remove the ruleset file (ignore if already missing)
    const filePath = rulesetFilePath(id);
    const info = await FileSystem.getInfoAsync(filePath);
    if (info.exists) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
    }

    // Remove from metadata index
    const index = await this.readMetadata();
    delete index[id];
    await this.writeMetadata(index);
  }

  /** Finds a stored ruleset by slug. Useful for duplicate detection. */
  async getBySlug(slug: string): Promise<StoredRuleset | null> {
    if (!slug) return null;

    await this.ensureDirectory();

    const index = await this.readMetadata();

    const entry = Object.entries(index).find(
      ([, meta]) => meta.slug === slug,
    );
    if (!entry) return null;

    return this.getById(entry[0]);
  }
}
