// Mock for expo-file-system — tests override these via vi.mock

export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
} as const;

export const documentDirectory: string = "file:///mock-document-dir/";

export async function readAsStringAsync(
  _fileUri: string,
  _options?: { encoding?: string },
): Promise<string> {
  throw new Error("readAsStringAsync is not mocked — use vi.mock in your test");
}

export async function writeAsStringAsync(
  _fileUri: string,
  _contents: string,
): Promise<void> {
  throw new Error(
    "writeAsStringAsync is not mocked — use vi.mock in your test",
  );
}

export async function deleteAsync(
  _fileUri: string,
  _options?: { idempotent?: boolean },
): Promise<void> {
  throw new Error("deleteAsync is not mocked — use vi.mock in your test");
}

export async function makeDirectoryAsync(
  _fileUri: string,
  _options?: { intermediates?: boolean },
): Promise<void> {
  throw new Error(
    "makeDirectoryAsync is not mocked — use vi.mock in your test",
  );
}

export async function getInfoAsync(
  _fileUri: string,
): Promise<{
  exists: boolean;
  isDirectory: boolean;
  uri: string;
  size: number;
  modificationTime: number;
}> {
  throw new Error("getInfoAsync is not mocked — use vi.mock in your test");
}
