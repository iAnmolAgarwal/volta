import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The AppSail API (Development). The browser calls a relative /api, and the dev
// server forwards it: the Catalyst gateway answers CORS preflights itself, without
// CORS headers, so the browser cannot POST JSON to AppSail directly (docs/api.md).
const API = "https://microgrid-proxy-50047164504.development.catalystappsail.in";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { proxy: { "/api": { target: API, changeOrigin: true, secure: true } } },
  preview: { proxy: { "/api": { target: API, changeOrigin: true, secure: true } } },
});
