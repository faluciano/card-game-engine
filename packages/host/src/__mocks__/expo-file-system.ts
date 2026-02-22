// Mock for expo-file-system — tests override these via vi.mock

export const EncodingType = {
  UTF8: "utf8",
  Base64: "base64",
} as const;

export async function readAsStringAsync(
  _fileUri: string,
  _options?: { encoding?: string },
): Promise<string> {
  throw new Error("readAsStringAsync is not mocked — use vi.mock in your test");
}
