import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    // Allow serving the repo-root rulesets/ JSON (imported by
    // @card-engine/host-core, which Vite resolves through the workspace
    // symlink to packages/host-core) and the sibling workspace packages.
    fs: { allow: [path.resolve(__dirname, "../..")] },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) replaces the object form of manualChunks.
        codeSplitting: {
          groups: [
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "engine", test: /[\\/]packages[\\/](shared|host-core)[\\/]/ },
          ],
        },
      },
    },
  },
});
