import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 4401,
    proxy: {
      "/api": {
        target: "http://localhost:4400",
        ws: true,
      },
    },
  },
});
