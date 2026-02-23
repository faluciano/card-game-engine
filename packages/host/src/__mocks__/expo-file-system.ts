// Mock for expo-file-system — tests override these via vi.mock
//
// Provides stub implementations of File, Directory, and Paths
// that match the real expo-file-system API shape.

/** Collapses duplicate slashes without mangling the protocol prefix (e.g. file:///). */
function normalizeUri(raw: string): string {
  const match = raw.match(/^([a-z]+:\/\/\/?)(.*)$/);
  if (match) {
    const [, protocol, rest] = match;
    return protocol! + rest!.replace(/\/+/g, "/");
  }
  return raw.replace(/\/+/g, "/");
}

/** Stub File class for testing. Methods throw by default — override via vi.mock. */
export class File {
  readonly uri: string;

  constructor(...segments: (string | { uri: string })[]) {
    const joined = segments
      .map((s) => (typeof s === "string" ? s : s.uri))
      .join("/");
    this.uri = normalizeUri(joined);
  }

  get exists(): boolean {
    throw new Error("File.exists is not mocked — use vi.mock in your test");
  }

  get name(): string {
    return this.uri.split("/").pop() ?? "";
  }

  async text(): Promise<string> {
    throw new Error("File.text() is not mocked — use vi.mock in your test");
  }

  textSync(): string {
    throw new Error("File.textSync() is not mocked — use vi.mock in your test");
  }

  write(_content: string): void {
    throw new Error("File.write() is not mocked — use vi.mock in your test");
  }

  create(
    _options?: { intermediates?: boolean; overwrite?: boolean },
  ): void {
    throw new Error("File.create() is not mocked — use vi.mock in your test");
  }

  delete(): void {
    throw new Error("File.delete() is not mocked — use vi.mock in your test");
  }
}

/** Stub Directory class for testing. */
export class Directory {
  readonly uri: string;

  constructor(...segments: (string | { uri: string })[]) {
    const joined = segments
      .map((s) => (typeof s === "string" ? s : s.uri))
      .join("/");
    const normalized = normalizeUri(joined);
    this.uri = normalized.endsWith("/") ? normalized : `${normalized}/`;
  }

  get exists(): boolean {
    throw new Error(
      "Directory.exists is not mocked — use vi.mock in your test",
    );
  }

  create(
    _options?: { intermediates?: boolean; idempotent?: boolean },
  ): void {
    throw new Error(
      "Directory.create() is not mocked — use vi.mock in your test",
    );
  }

  delete(): void {
    throw new Error(
      "Directory.delete() is not mocked — use vi.mock in your test",
    );
  }

  list(): (File | Directory)[] {
    throw new Error(
      "Directory.list() is not mocked — use vi.mock in your test",
    );
  }
}

/** Stub Paths for testing. */
export const Paths = {
  document: new Directory("file:///mock-document-dir"),
  cache: new Directory("file:///mock-cache-dir"),
} as const;
