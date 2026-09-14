import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) replaces the object form of manualChunks.
        codeSplitting: {
          groups: [
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            // Zod + the ruleset schema are only reached through dynamic
            // import() when a user installs a ruleset, so they get their own
            // async chunk. `includeDependenciesRecursively` must be off:
            // otherwise the group also captures the schema's engine
            // dependencies (RulesetParseError -> interpreter -> ...), which the
            // initial path needs, and `engine` ends up statically importing
            // `schema` — putting Zod straight back into the initial download.
            {
              name: "schema",
              test: /[\\/](node_modules[\\/]zod|packages[\\/]shared[\\/]src[\\/]schema)[\\/]/,
              includeDependenciesRecursively: false,
            },
            // Everything else from the workspace packages (the schema folder
            // is excluded so a priority tie can never pull it back in here).
            {
              name: "engine",
              test: /[\\/]packages[\\/](shared[\\/]src[\\/](?!schema[\\/])|host-core[\\/])/,
            },
          ],
        },
      },
    },
  },
});
