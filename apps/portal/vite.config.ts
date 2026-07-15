import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The portal is a static SPA. In dev the Vite server proxies /api to the
// admin-api (section 5.1 combined portal + admin approach).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
