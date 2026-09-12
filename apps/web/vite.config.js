import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** One SPA. The Lambda owns /auth/* and /api/*; in development they are
 *  proxied to a local runner (services/api/local.mjs) on 4320. */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4320",
      "/auth": "http://localhost:4320",
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
