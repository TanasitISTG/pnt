import { expect, test } from "@playwright/test";

test("EPUB account quota returns HTTP 429 without a guest IP", async ({ page }) => {
  await page.goto("/login");
  await page.waitForFunction(() => {
    const submit = document.querySelector('button[type="submit"]');
    return submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$"));
  });
  const reject = page.getByRole("button", { name: "Reject optional" });
  if (await reject.isVisible()) await reject.click();
  await page.getByLabel("Email").fill("e2e-admin@example.test");
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();

  // Invalid filenames fail before admission, but after the authenticated quota check;
  // no upload or chapter is persisted. Call the real client proxy and inspect its HTTP responses.
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.request().resourceType() === "fetch") {
      statuses.push(response.status());
    }
  });
  await page.evaluate(async () => {
    // The Vite client proxy exists only in the browser; importing it in the Playwright
    // process would instead load the server module and its environment.
    // @ts-expect-error /src is served by Vite, not resolved by Playwright's tsconfig.
    const { createEpubUpload } = await import("/src/lib/epub/functions.ts");
    for (let index = 0; index < 7; index += 1) {
      try {
        await createEpubUpload({
          data: { novelId: "unused", fileName: "invalid.txt", fileSize: 1, chunkCount: 1 },
        });
      } catch {
        // Expected: filename rejection for six calls, then quota rejection.
      }
    }
  });
  expect(statuses).toHaveLength(7);
  expect(statuses.slice(0, 6)).not.toContain(429);
  expect(statuses[6]).toBe(429);
});
