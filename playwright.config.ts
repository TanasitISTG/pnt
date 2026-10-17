import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  // Signs each account in once and saves the session (see `e2e/sessions.ts`). Tests that need a
  // signed-in reader opt in with `test.use({ storageState: ... })`; the default stays a guest.
  globalSetup: "./e2e/global-setup.ts",
  // Reads the seeded accounts back once the tests are over, so a spec that changed one and did not
  // hand it back fails the run that caused it (see `e2e/global-teardown.ts`).
  globalTeardown: "./e2e/global-teardown.ts",
  outputDir: ".tura/e2e/test-results",
  use: {
    baseURL: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
