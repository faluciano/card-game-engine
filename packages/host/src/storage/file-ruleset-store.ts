// ─── File Ruleset Store ────────────────────────────────────────────
// CRUD operations for rulesets stored as JSON files on the device.
// Uses expo-file-system File/Directory API for zero native-dependency simplicity.

import { File, Directory, Paths } from "expo-file-system";
import type { CardGameRuleset } from "@card-engine/shared";
import type { RulesetStore, StoredRuleset } from "@card-engine/host-core";
import { RulesetStoreCorruptError, generateRulesetId } from "@card-engine/host-core";

export type { StoredRuleset };

/** Metadata for a single stored ruleset (everything except the ruleset itself). */
interface RulesetMetadataEntry {
  readonly slug: string;
  readonly importedAt: number;
  readonly lastPlayedAt: number | null;
}

/** The full metadata index: id -> entry. */
type MetadataIndex = Record<string, RulesetMetadataEntry>;

// ─── Internal Helpers ──────────────────────────────────────────────

/** A metadata index must be a plain JSON object keyed by id. */
function isMetadataIndex(value: unknown): value is MetadataIndex {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export class FileRulesetStore implements RulesetStore {
  private readonly rulesetsDir = new Directory(Paths.document, "rulesets");
  private readonly metadataFile = new File(this.rulesetsDir, "_metadata.json");

  /** Returns a File handle for the given ruleset ID. */
  private rulesetFile(id: string): File {
    return new File(this.rulesetsDir, `${id}.cardgame.json`);
  }

  /** Creates the rulesets directory if it doesn't exist. */
  private ensureDirectory(): void {
    // Guard first: passing a `DirectoryCreateOptions` map (e.g.
    // `{ intermediates, idempotent }`) crashes on the old React Native
    // architecture — Expo cannot cast the ReadableNativeMap to the native
    // `CreateOptions` record, throwing ERR_UNEXPECTED. `Paths.document`
    // always exists, so we only need to create the single `rulesets` dir,
    // and the `exists` check makes the operation idempotent without options.
    if (this.rulesetsDir.exists) return;
    this.rulesetsDir.create();
  }

  /**
   * Reads and parses the metadata index. A missing file is an empty library;
   * an unparseable one throws {@link RulesetStoreCorruptError} so a later
   * save cannot overwrite the whole library with a single entry.
   */
  private async readMetadata(): Promise<MetadataIndex> {
    if (!this.metadataFile.exists) return {};

    const raw = await this.metadataFile.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new RulesetStoreCorruptError(this.metadataFile.uri, err);
    }
    if (!isMetadataIndex(parsed)) {
      throw new RulesetStoreCorruptError(
        this.metadataFile.uri,
        `expected an object keyed by id, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      );
    }
    return parsed;
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
      } catch (err) {
        // Skip the entry but say so: a silently vanishing game looks like data loss.
        console.warn(
          `[FileRulesetStore] Skipping ruleset "${meta.slug}" (${id}): could not read or parse`,
          err,
        );
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
    return this.saveWithSlug(ruleset, ruleset.meta.slug);
  }

  /** Saves a new ruleset, using the given slug for metadata instead of the ruleset's own slug. */
  async saveWithSlug(ruleset: CardGameRuleset, slugOverride: string): Promise<StoredRuleset> {
    this.ensureDirectory();

    // Read the index first: if it is corrupt this throws before anything is
    // written, so no orphan ruleset file is left behind.
    const index = await this.readMetadata();

    const id = generateRulesetId();
    const now = Date.now();

    // Write the ruleset file (unchanged JSON)
    this.rulesetFile(id).write(JSON.stringify(ruleset, null, 2));

    // Update metadata with override slug
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

    const entry = Object.entries(index).find(([, meta]) => meta.slug === slug);
    if (!entry) return null;

    return this.getById(entry[0]);
  }
}
