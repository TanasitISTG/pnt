import { expect, test } from "@playwright/test";

import { claimShared } from "./fixtures";
import { openReadingHome, takeSession } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

test("EPUB account quota returns HTTP 429 without a guest IP", async ({ page }) => {
  await openReadingHome(page);

  // The account's whole upload window, spent on purpose: the declaration (`e2e/fixtures.ts`) is
  // what says this spec is the one that may spend it, and what the app's limit is.
  const quota = claimShared("admin-epub-window", "spend", "epub-rate-limit");
  const attempts = quota.limit + 1;

  // Invalid filenames fail before admission, but after the authenticated quota check;
  // no upload or chapter is persisted. Call the real client proxy and inspect its HTTP responses.
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.request().resourceType() === "fetch") {
      statuses.push(response.status());
    }
  });
  await page.evaluate(async (calls) => {
    // The Vite client proxy exists only in the browser; importing it in the Playwright
    // process would instead load the server module and its environment.
    // @ts-expect-error /src is served by Vite, not resolved by Playwright's tsconfig.
    const { createEpubUpload } = await import("/src/lib/epub/functions.ts");
    for (let index = 0; index < calls; index += 1) {
      try {
        await createEpubUpload({
          data: { novelId: "unused", fileName: "invalid.txt", fileSize: 1 },
        });
      } catch {
        // Expected: filename rejection for every call the window allows, then quota rejection.
      }
    }
  }, attempts);
  expect(statuses).toHaveLength(attempts);
  expect(statuses.slice(0, quota.limit)).not.toContain(429);
  expect(statuses[quota.limit]).toBe(429);
});
