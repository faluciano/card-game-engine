import { describe, it, expect, vi, beforeEach } from "vitest";
import * as FileSystem from "expo-file-system";
import { FileRulesetStore } from "./file-ruleset-store";

// ══════════════════════════════════════════════════════════════════════
// Mocks
// ══════════════════════════════════════════════════════════════════════

vi.mock("expo-file-system", async () => {
  return {
    documentDirectory: "file:///mock-document-dir/",
    EncodingType: { UTF8: "utf8", Base64: "base64" },
    readAsStringAsync: vi.fn(),
    writeAsStringAsync: vi.fn(),
    deleteAsync: vi.fn(),
    makeDirectoryAsync: vi.fn(),
    getInfoAsync: vi.fn(),
  };
});

const mockRead = FileSystem.readAsStringAsync as ReturnType<typeof vi.fn>;
const mockWrite = FileSystem.writeAsStringAsync as ReturnType<typeof vi.fn>;
const mockDelete = FileSystem.deleteAsync as ReturnType<typeof vi.fn>;
const mockMkdir = FileSystem.makeDirectoryAsync as ReturnType<typeof vi.fn>;
const mockGetInfo = FileSystem.getInfoAsync as ReturnType<typeof vi.fn>;

// ══════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════

const RULESETS_DIR = "file:///mock-document-dir/rulesets/";
const METADATA_PATH = `${RULESETS_DIR}_metadata.json`;

// ══════════════════════════════════════════════════════════════════════
// Factories
// ══════════════════════════════════════════════════════════════════════

function makeRuleset(slug = "test-game", name = "Test Game") {
  return {
    meta: {
      slug,
      name,
      version: "1.0.0",
      author: "Test",
      players: { min: 2, max: 4 },
    },
    deck: { preset: "standard52" },
    zones: [],
    setup: [],
    phases: [],
    scoring: { type: "manual" },
  };
}

function makeMetadataIndex(
  entries: Record<
    string,
    { slug: string; importedAt: number; lastPlayedAt: number | null }
  >,
) {
  return entries;
}

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

/**
 * Sets up path-based mock implementations for `getInfoAsync` and
 * `readAsStringAsync`. Accepts a map of file paths to their content
 * and existence info.
 */
function setupFileSystem(
  files: Record<
    string,
    { exists: boolean; content?: string }
  >,
) {
  mockGetInfo.mockImplementation((path: string) => {
    const entry = files[path];
    if (entry) return Promise.resolve({ exists: entry.exists });
    return Promise.resolve({ exists: false });
  });

  mockRead.mockImplementation((path: string) => {
    const entry = files[path];
    if (entry?.content !== undefined) return Promise.resolve(entry.content);
    return Promise.reject(new Error(`File not found: ${path}`));
  });
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("FileRulesetStore", () => {
  let store: FileRulesetStore;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = new FileRulesetStore();

    // Default: directory exists, no metadata file
    mockMkdir.mockResolvedValue(undefined);
    mockGetInfo.mockResolvedValue({ exists: false });
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  // ── list() ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when no metadata file exists", async () => {
      // getInfoAsync returns { exists: false } for metadata path (default)
      const result = await store.list();

      expect(result).toEqual([]);
    });

    it("returns stored rulesets sorted by importedAt descending", async () => {
      const rulesetA = makeRuleset("game-a", "Game A");
      const rulesetB = makeRuleset("game-b", "Game B");

      const metadata = makeMetadataIndex({
        "id-older": {
          slug: "game-a",
          importedAt: 1000,
          lastPlayedAt: null,
        },
        "id-newer": {
          slug: "game-b",
          importedAt: 2000,
          lastPlayedAt: 1500,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}id-older.cardgame.json`]: {
          exists: true,
          content: JSON.stringify(rulesetA),
        },
        [`${RULESETS_DIR}id-newer.cardgame.json`]: {
          exists: true,
          content: JSON.stringify(rulesetB),
        },
      });

      const result = await store.list();

      expect(result).toHaveLength(2);
      // Most recent first
      expect(result[0]).toEqual({
        id: "id-newer",
        ruleset: rulesetB,
        importedAt: 2000,
        lastPlayedAt: 1500,
      });
      expect(result[1]).toEqual({
        id: "id-older",
        ruleset: rulesetA,
        importedAt: 1000,
        lastPlayedAt: null,
      });
    });

    it("skips entries with missing ruleset files", async () => {
      const rulesetGood = makeRuleset("good-game", "Good Game");

      const metadata = makeMetadataIndex({
        "id-good": {
          slug: "good-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
        "id-missing": {
          slug: "missing-game",
          importedAt: 2000,
          lastPlayedAt: null,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}id-good.cardgame.json`]: {
          exists: true,
          content: JSON.stringify(rulesetGood),
        },
        // id-missing has no file entry — readAsStringAsync will throw
      });

      const result = await store.list();

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("id-good");
    });
  });

  // ── save() ──────────────────────────────────────────────────────

  describe("save()", () => {
    it("writes ruleset file and updates metadata", async () => {
      const now = 1700000000000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
        "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee" as `${string}-${string}-${string}-${string}-${string}`,
      );

      // No existing metadata
      setupFileSystem({
        [METADATA_PATH]: { exists: false },
      });

      const ruleset = makeRuleset("my-game", "My Game");
      const result = await store.save(ruleset);

      // Verify returned StoredRuleset shape
      expect(result).toEqual({
        id: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
        ruleset,
        importedAt: now,
        lastPlayedAt: null,
      });

      // Verify write was called twice: ruleset file + metadata
      expect(mockWrite).toHaveBeenCalledTimes(2);

      // First call: ruleset file
      expect(mockWrite).toHaveBeenCalledWith(
        `${RULESETS_DIR}aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee.cardgame.json`,
        JSON.stringify(ruleset, null, 2),
      );

      // Second call: metadata — parse to verify content
      const metadataWriteCall = mockWrite.mock.calls[1]!;
      expect(metadataWriteCall[0]).toBe(METADATA_PATH);
      const writtenMetadata = JSON.parse(metadataWriteCall[1] as string);
      expect(
        writtenMetadata["aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee"],
      ).toEqual({
        slug: "my-game",
        importedAt: now,
        lastPlayedAt: null,
      });
    });

    it("creates directory if missing", async () => {
      setupFileSystem({
        [METADATA_PATH]: { exists: false },
      });

      await store.save(makeRuleset());

      expect(mockMkdir).toHaveBeenCalledWith(RULESETS_DIR, {
        intermediates: true,
      });
    });
  });

  // ── getById() ───────────────────────────────────────────────────

  describe("getById()", () => {
    it("returns null for empty string", async () => {
      const result = await store.getById("");

      expect(result).toBeNull();
      // Should early exit — no file system calls
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it("returns null when ID not in metadata", async () => {
      const metadata = makeMetadataIndex({});

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
      });

      const result = await store.getById("nonexistent-id");

      expect(result).toBeNull();
    });

    it("returns stored ruleset when found", async () => {
      const ruleset = makeRuleset("found-game", "Found Game");
      const metadata = makeMetadataIndex({
        "found-id": {
          slug: "found-game",
          importedAt: 5000,
          lastPlayedAt: 4000,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}found-id.cardgame.json`]: {
          exists: true,
          content: JSON.stringify(ruleset),
        },
      });

      const result = await store.getById("found-id");

      expect(result).toEqual({
        id: "found-id",
        ruleset,
        importedAt: 5000,
        lastPlayedAt: 4000,
      });
    });
  });

  // ── delete() ────────────────────────────────────────────────────

  describe("delete()", () => {
    it("removes file and metadata entry", async () => {
      const metadata = makeMetadataIndex({
        "del-id": {
          slug: "del-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}del-id.cardgame.json`]: { exists: true },
      });

      await store.delete("del-id");

      // Verify deleteAsync was called for the ruleset file
      expect(mockDelete).toHaveBeenCalledWith(
        `${RULESETS_DIR}del-id.cardgame.json`,
        { idempotent: true },
      );

      // Verify metadata was rewritten without the entry
      const metadataWriteCall = mockWrite.mock.calls.find(
        (call) => call[0] === METADATA_PATH,
      );
      expect(metadataWriteCall).toBeDefined();
      const writtenMetadata = JSON.parse(metadataWriteCall![1] as string);
      expect(writtenMetadata["del-id"]).toBeUndefined();
    });

    it("no-op for empty string", async () => {
      await store.delete("");

      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockWrite).not.toHaveBeenCalled();
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it("handles already-missing file gracefully", async () => {
      const metadata = makeMetadataIndex({
        "gone-id": {
          slug: "gone-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}gone-id.cardgame.json`]: { exists: false },
      });

      await store.delete("gone-id");

      // deleteAsync should NOT have been called (file doesn't exist)
      expect(mockDelete).not.toHaveBeenCalled();

      // But metadata should still be updated
      const metadataWriteCall = mockWrite.mock.calls.find(
        (call) => call[0] === METADATA_PATH,
      );
      expect(metadataWriteCall).toBeDefined();
      const writtenMetadata = JSON.parse(metadataWriteCall![1] as string);
      expect(writtenMetadata["gone-id"]).toBeUndefined();
    });
  });

  // ── getBySlug() ─────────────────────────────────────────────────

  describe("getBySlug()", () => {
    it("returns null for empty string", async () => {
      const result = await store.getBySlug("");

      expect(result).toBeNull();
      // Should early exit — no file system calls
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it("returns null when slug not found", async () => {
      const metadata = makeMetadataIndex({
        "some-id": {
          slug: "other-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
      });

      const result = await store.getBySlug("nonexistent-slug");

      expect(result).toBeNull();
    });

    it("returns matching ruleset", async () => {
      const ruleset = makeRuleset("target-slug", "Target Game");
      const metadata = makeMetadataIndex({
        "target-id": {
          slug: "target-slug",
          importedAt: 3000,
          lastPlayedAt: null,
        },
        "other-id": {
          slug: "other-slug",
          importedAt: 2000,
          lastPlayedAt: null,
        },
      });

      setupFileSystem({
        [METADATA_PATH]: {
          exists: true,
          content: JSON.stringify(metadata),
        },
        [`${RULESETS_DIR}target-id.cardgame.json`]: {
          exists: true,
          content: JSON.stringify(ruleset),
        },
      });

      const result = await store.getBySlug("target-slug");

      expect(result).toEqual({
        id: "target-id",
        ruleset,
        importedAt: 3000,
        lastPlayedAt: null,
      });
    });
  });
});
