import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Mock React Native native modules that don't exist in Node
    alias: {
      "@op-engineering/op-sqlite": new URL("./src/__mocks__/op-sqlite.ts", import.meta.url).pathname,
      "expo-file-system": new URL("./src/__mocks__/expo-file-system.ts", import.meta.url).pathname,
    },
  },
});
