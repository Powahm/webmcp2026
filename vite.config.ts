import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // react-force-graph-3d depends on its own copy of three. Two copies in the
  // bundle means two class identities: objects built with one fail instanceof
  // checks and calls into the other hit methods that version does not have.
  // Force a single copy.
  resolve: { dedupe: ["three"] },
  build: { target: "es2022", sourcemap: true },
});
