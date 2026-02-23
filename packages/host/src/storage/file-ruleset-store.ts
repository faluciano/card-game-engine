// ─── File Ruleset Store ────────────────────────────────────────────
// CRUD operations for rulesets stored as JSON files on the device.
// Uses expo-file-system File/Directory API for zero native-dependency simplicity.

import { File, Directory, Paths } from "expo-file-system";
import type { CardGameRuleset } from "@card-engine/shared";
import type { StoredRuleset } from "./ruleset-store";

// Re-export StoredRuleset so consumers don't need to import from two files
export type { StoredRuleset } from "./ruleset-store";

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

// ─── File Ruleset Store ────────────────────────────────────────────

/**
 * Manages ruleset persistence using the device file system.
 *
 * Storage layout:
 * ```
 * ${Paths.document}/rulesets/
 * ├── _metadata.json          <- { [id]: { slug, importedAt, lastPlayedAt } }
 * ├── {id}.cardgame.json      <- raw ruleset JSON
 * ```
 */
export class FileRulesetStore {
  private readonly rulesetsDir = new Directory(Paths.document, "rulesets");
  private readonly metadataFile = new File(this.rulesetsDir, "_metadata.json");

  /** Returns a File handle for the given ruleset ID. */
  private rulesetFile(id: string): File {
    return new File(this.rulesetsDir, `${id}.cardgame.json`);
  }

  /** Creates the rulesets directory if it doesn't exist. */
  private ensureDirectory(): void {
    this.rulesetsDir.create({ intermediates: true, idempotent: true });
  }

  /** Reads and parses the metadata index. Returns `{}` on missing or corrupt file. */
  private async readMetadata(): Promise<MetadataIndex> {
    if (!this.metadataFile.exists) return {};

    try {
      const raw = await this.metadataFile.text();
      return JSON.parse(raw) as MetadataIndex;
    } catch {
      return {};
    }
  }

  /** Writes the metadata index to disk. */
  private writeMetadata(index: MetadataIndex): void {
    this.metadataFile.write(JSON.stringify(index, null, 2));
  }

  /** Lists all stored rulesets, sorted by importedAt descending. */
  async list(): Promise<readonly StoredRuleset[]> {
    this.ensureDirectory();

    const index = await this.readMetadata();
    const entries = Object.entries(index);
    const results: StoredRuleset[] = [];

    for (const [id, meta] of entries) {
      try {
        const raw = await this.rulesetFile(id).text();
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

    this.ensureDirectory();

    const index = await this.readMetadata();
    const meta = index[id];
    if (!meta) return null;

    try {
      const raw = await this.rulesetFile(id).text();
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
    this.ensureDirectory();

    const id = generateId();
    const now = Date.now();

    // Write the ruleset file
    this.rulesetFile(id).write(JSON.stringify(ruleset, null, 2));

    // Update metadata index
    const index = await this.readMetadata();
    index[id] = {
      slug: ruleset.meta.slug,
      importedAt: now,
      lastPlayedAt: null,
    };
    this.writeMetadata(index);

    return {
      id,
      ruleset,
      importedAt: now,
      lastPlayedAt: null,
    };
  }

  /** Saves a new ruleset, using the given slug for metadata instead of the ruleset's own slug. */
  async saveWithSlug(ruleset: CardGameRuleset, slugOverride: string): Promise<StoredRuleset> {
    this.ensureDirectory();

    const id = generateId();
    const now = Date.now();

    // Write the ruleset file (unchanged JSON)
    this.rulesetFile(id).write(JSON.stringify(ruleset, null, 2));

    // Update metadata with override slug
    const index = await this.readMetadata();
    index[id] = {
      slug: slugOverride,
      importedAt: now,
      lastPlayedAt: null,
    };
    this.writeMetadata(index);

    return { id, ruleset, importedAt: now, lastPlayedAt: null };
  }

  /** Deletes a stored ruleset by ID. */
  async delete(id: string): Promise<void> {
    if (!id) return;

    this.ensureDirectory();

    // Remove the ruleset file (skip if already missing)
    const file = this.rulesetFile(id);
    if (file.exists) {
      file.delete();
    }

    // Remove from metadata index
    const index = await this.readMetadata();
    delete index[id];
    this.writeMetadata(index);
  }

  /** Finds a stored ruleset by slug. Useful for duplicate detection. */
  async getBySlug(slug: string): Promise<StoredRuleset | null> {
    if (!slug) return null;

    this.ensureDirectory();

    const index = await this.readMetadata();

    const entry = Object.entries(index).find(
      ([, meta]) => meta.slug === slug,
    );
    if (!entry) return null;

    return this.getById(entry[0]);
  }
}
