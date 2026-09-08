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
            { name: "engine", test: /[\\/]packages[\\/](shared|host-core)[\\/]/ },
          ],
        },
      },
    },
  },
});
