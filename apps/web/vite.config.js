import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** One SPA. The Lambda owns /auth/* and /api/*; in development they are
 *  proxied to a local runner (services/api/local.mjs) on 4320. Tailwind
 *  compiles src/styles.css: Elixir's tokens and components from the
 *  pinned dependency, plus the utilities this app and the kit use. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:4320",
      "/auth": "http://localhost:4320",
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    // Playwright's journeys live in e2e/ and run under its own runner.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
