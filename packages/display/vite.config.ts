import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    // Allow importing the bundled ruleset JSON from the repo-root rulesets/ dir.
    fs: { allow: [".."] },
  },
  build: {
    target: "ES2022",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          engine: ["@card-engine/shared"],
        },
      },
    },
  },
});
