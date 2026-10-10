import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  outputDir: ".tura/e2e/test-results",
  use: {
    baseURL: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
