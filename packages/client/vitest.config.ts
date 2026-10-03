import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-function tests only (src/lib); no DOM environment needed.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
