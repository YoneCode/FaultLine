import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import faultlineEditor from "./tools/editor-plugin.js";

export default defineConfig({
  plugins: [react(), faultlineEditor()],
  server: { port: 5199, host: "127.0.0.1" },
  build: { outDir: "dist", sourcemap: false },
});
