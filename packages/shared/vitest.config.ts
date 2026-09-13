import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run source tests; `dist/` holds tsc -b output of the same files.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
