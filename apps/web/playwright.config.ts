import { defineConfig, devices } from "@playwright/test";

/**
 * Journeys against the BUILT app served by `vite preview` (which falls
 * back to index.html the way the edge's SPA router does). /api/* is
 * answered by each journey's fixtures (e2e/fixtures.ts), so this runs
 * without the Lambda and exercises the real bundle, the real router,
 * the kit from the pinned dependency. `npm run e2e` from the repo root.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4322",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "wide",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@narrow/,
    },
    {
      name: "narrow",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 420, height: 860 },
      },
      grep: /@narrow/,
    },
  ],
  webServer: {
    command:
      "npm run build && npx vite preview --host 127.0.0.1 --port 4322 --strictPort",
    url: "http://127.0.0.1:4322/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
