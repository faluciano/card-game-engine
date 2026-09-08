import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Mock React Native native modules that don't exist in Node
    alias: {
      "expo-file-system": new URL("./src/__mocks__/expo-file-system.ts", import.meta.url).pathname,
    },
  },
});
