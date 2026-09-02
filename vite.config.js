import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * `--mode verify` drops the content hashes from the output filenames.
 *
 * Production keeps them, because cache busting matters on a deployed site.
 * The verification harness needs a stable file list to serve and screenshot,
 * and renaming five files on every build is not worth the ceremony.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173 },
  build:
    mode === "verify"
      ? {
          rollupOptions: {
            output: {
              entryFileNames: "assets/[name].js",
              chunkFileNames: "assets/[name].js",
              assetFileNames: "assets/[name].[ext]",
            },
          },
        }
      : {},
}));
