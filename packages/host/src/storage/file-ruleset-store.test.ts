import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileRulesetStore } from "./file-ruleset-store";

// ══════════════════════════════════════════════════════════════════════
// In-memory file system mock
// ══════════════════════════════════════════════════════════════════════

const mockFiles = new Map<string, string>();

vi.mock("expo-file-system", () => {
  /** Collapses duplicate slashes without mangling the protocol (e.g. file:///). */
  function normalizeUri(raw: string): string {
    const match = raw.match(/^([a-z]+:\/\/\/?)(.*)$/);
    if (match) {
      const [, protocol, rest] = match;
      return protocol! + rest!.replace(/\/+/g, "/");
    }
    return raw.replace(/\/+/g, "/");
  }

  class MockFile {
    readonly uri: string;

    constructor(...segments: (string | { uri: string })[]) {
      const joined = segments
        .map((s) => (typeof s === "string" ? s : s.uri))
        .join("/");
      this.uri = normalizeUri(joined);
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }

    async text(): Promise<string> {
      const content = mockFiles.get(this.uri);
      if (content === undefined) throw new Error(`File not found: ${this.uri}`);
      return content;
    }

    write(content: string): void {
      mockFiles.set(this.uri, content);
    }

    delete(): void {
      mockFiles.delete(this.uri);
    }
  }

  class MockDirectory {
    readonly uri: string;

    constructor(...segments: (string | { uri: string })[]) {
      const joined = segments
        .map((s) => (typeof s === "string" ? s : s.uri))
        .join("/");
      const normalized = normalizeUri(joined);
      this.uri = normalized.endsWith("/") ? normalized : `${normalized}/`;
    }

    create(): void {
      /* no-op — directories are virtual in the mock */
    }

    get exists(): boolean {
      return true;
    }
  }

  const mockPaths = {
    document: new MockDirectory("file:///mock-document-dir"),
    cache: new MockDirectory("file:///mock-cache-dir"),
  };

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: mockPaths,
  };
});

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
 * Writes a file into the in-memory mock file system.
 */
function setFile(path: string, content: string): void {
  mockFiles.set(path, content);
}

/**
 * Reads a file from the in-memory mock file system.
 * Returns undefined if the file doesn't exist.
 */
function getFile(path: string): string | undefined {
  return mockFiles.get(path);
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("FileRulesetStore", () => {
  let store: FileRulesetStore;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFiles.clear();
    store = new FileRulesetStore();
  });

  // ── list() ──────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns empty array when no metadata file exists", async () => {
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

      setFile(METADATA_PATH, JSON.stringify(metadata));
      setFile(
        `${RULESETS_DIR}id-older.cardgame.json`,
        JSON.stringify(rulesetA),
      );
      setFile(
        `${RULESETS_DIR}id-newer.cardgame.json`,
        JSON.stringify(rulesetB),
      );

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

      setFile(METADATA_PATH, JSON.stringify(metadata));
      setFile(
        `${RULESETS_DIR}id-good.cardgame.json`,
        JSON.stringify(rulesetGood),
      );
      // id-missing has no file — .text() will throw

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

      const ruleset = makeRuleset("my-game", "My Game");
      const result = await store.save(ruleset);

      // Verify returned StoredRuleset shape
      expect(result).toEqual({
        id: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
        ruleset,
        importedAt: now,
        lastPlayedAt: null,
      });

      // Verify ruleset file was written
      const writtenRuleset = getFile(
        `${RULESETS_DIR}aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee.cardgame.json`,
      );
      expect(writtenRuleset).toBe(JSON.stringify(ruleset, null, 2));

      // Verify metadata was written
      const writtenMetadata = JSON.parse(getFile(METADATA_PATH)!);
      expect(
        writtenMetadata["aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee"],
      ).toEqual({
        slug: "my-game",
        importedAt: now,
        lastPlayedAt: null,
      });
    });

    it("creates directory without throwing", async () => {
      // Just verify save() completes — ensureDirectory() is called internally
      await expect(store.save(makeRuleset())).resolves.toBeDefined();
    });
  });

  // ── getById() ───────────────────────────────────────────────────

  describe("getById()", () => {
    it("returns null for empty string", async () => {
      const result = await store.getById("");

      expect(result).toBeNull();
    });

    it("returns null when ID not in metadata", async () => {
      const metadata = makeMetadataIndex({});

      setFile(METADATA_PATH, JSON.stringify(metadata));

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

      setFile(METADATA_PATH, JSON.stringify(metadata));
      setFile(
        `${RULESETS_DIR}found-id.cardgame.json`,
        JSON.stringify(ruleset),
      );

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

      setFile(METADATA_PATH, JSON.stringify(metadata));
      setFile(`${RULESETS_DIR}del-id.cardgame.json`, "{}");

      await store.delete("del-id");

      // Verify ruleset file was removed
      expect(getFile(`${RULESETS_DIR}del-id.cardgame.json`)).toBeUndefined();

      // Verify metadata was rewritten without the entry
      const writtenMetadata = JSON.parse(getFile(METADATA_PATH)!);
      expect(writtenMetadata["del-id"]).toBeUndefined();
    });

    it("no-op for empty string", async () => {
      await store.delete("");

      // No files should have been written
      expect(mockFiles.size).toBe(0);
    });

    it("handles already-missing file gracefully", async () => {
      const metadata = makeMetadataIndex({
        "gone-id": {
          slug: "gone-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
      });

      setFile(METADATA_PATH, JSON.stringify(metadata));
      // No ruleset file for "gone-id" — should not throw

      await store.delete("gone-id");

      // Metadata should still be updated
      const writtenMetadata = JSON.parse(getFile(METADATA_PATH)!);
      expect(writtenMetadata["gone-id"]).toBeUndefined();
    });
  });

  // ── saveWithSlug() ───────────────────────────────────────────────

  describe("saveWithSlug()", () => {
    it("stores ruleset with overridden slug in metadata", async () => {
      vi.spyOn(Date, "now").mockReturnValue(1700000000000);
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
        "slug-override-id" as `${string}-${string}-${string}-${string}-${string}`,
      );

      const ruleset = makeRuleset("original-slug", "Original Name");
      const result = await store.saveWithSlug(ruleset, "custom-slug");

      expect(result.id).toBe("slug-override-id");

      // Verify metadata uses overridden slug
      const metadata = JSON.parse(getFile(METADATA_PATH)!);
      expect(metadata["slug-override-id"].slug).toBe("custom-slug");

      // Verify ruleset file still has original slug
      const rulesetFile = JSON.parse(
        getFile(`${RULESETS_DIR}slug-override-id.cardgame.json`)!,
      );
      expect(rulesetFile.meta.slug).toBe("original-slug");
    });

    it("is findable by the overridden slug via getBySlug", async () => {
      const ruleset = makeRuleset("original-slug", "Original Name");
      await store.saveWithSlug(ruleset, "custom-slug");

      const found = await store.getBySlug("custom-slug");
      expect(found).not.toBeNull();
      expect(found!.ruleset.meta.slug).toBe("original-slug");

      // Not findable by original slug
      const notFound = await store.getBySlug("original-slug");
      expect(notFound).toBeNull();
    });
  });

  // ── getBySlug() ─────────────────────────────────────────────────

  describe("getBySlug()", () => {
    it("returns null for empty string", async () => {
      const result = await store.getBySlug("");

      expect(result).toBeNull();
    });

    it("returns null when slug not found", async () => {
      const metadata = makeMetadataIndex({
        "some-id": {
          slug: "other-game",
          importedAt: 1000,
          lastPlayedAt: null,
        },
      });

      setFile(METADATA_PATH, JSON.stringify(metadata));

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

      setFile(METADATA_PATH, JSON.stringify(metadata));
      setFile(
        `${RULESETS_DIR}target-id.cardgame.json`,
        JSON.stringify(ruleset),
      );

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
