import { expect, test } from "@playwright/test";

import { claimShared } from "./fixtures";
import { waitForHydration } from "./sessions";

// Only the replay requests carry this identity; navigation and other specs cannot
// consume its window. No account or novel fixture is required by listNovels: the
// address the app counts it for, and the limit it holds, are the declaration's
// (`e2e/fixtures.ts`), which is also what says this spec may spend one whole window.

test("guest listNovels returns a safe HTTP 429 on request 61", async ({ page }, testInfo) => {
  // The window this spec spends, taken where it spends it: a refusal here is the run saying the
  // fixture was already claimed, or that the claim belongs to another spec.
  const guestWindow = claimShared("guest-read-window", "spend", "guest-rate-limit");

  await page.goto("/privacy");
  await waitForHydration(page.getByRole("link", { name: "Catalog", exact: true }).first());
  const reject = page.getByRole("button", { name: "Reject optional" });
  if (await reject.isVisible()) await reject.click();

  // Discover the generated RPC URL from a real client-side route load, rather
  // than coupling the test to TanStack's build-dependent function identifier.
  // listNovels uniquely emits the "novels" Server-Timing metric on this route.
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().resourceType() === "fetch" &&
      /(?:^|,\s*)novels;dur=/.test(response.headers()["server-timing"] ?? ""),
  );
  await page.getByRole("link", { name: "Catalog", exact: true }).first().click();
  const discovered = await responsePromise;
  expect(discovered.status()).toBe(200);
  const request = discovered.request();
  expect(request.method()).toBe("GET");
  const endpoint = request.url();
  await testInfo.attach("listNovels-endpoint", { body: endpoint, contentType: "text/plain" });

  // Preserve the RPC protocol headers, not browser cookies or transport headers.
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(
      ([name]) => name === "accept" || name === "content-type" || name.startsWith("x-"),
    ),
  );
  headers["x-forwarded-for"] = guestWindow.subject;
  const result = await page.evaluate(
    async ({ endpoint: requestUrl, headers: requestHeaders, attempts }) => {
      const startedAt = performance.now();
      const statuses: number[] = [];
      let lastBody = "";
      for (let index = 0; index < attempts; index++) {
        const response = await fetch(requestUrl, {
          method: "GET",
          headers: requestHeaders,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        statuses.push(response.status);
        lastBody = await response.text();
      }
      return { statuses, lastBody, elapsedMs: performance.now() - startedAt };
    },
    { endpoint, headers, attempts: guestWindow.limit + 1 },
  );

  expect(result.elapsedMs, "all requests must remain within one fixed window").toBeLessThan(60_000);
  expect(result.statuses.slice(0, guestWindow.limit)).toEqual(
    Array<number>(guestWindow.limit).fill(200),
  );
  expect(result.statuses[guestWindow.limit]).toBe(429);
  // The wire form of server copy is a message key, never a sentence: the language of the
  // refusal is decided where it is rendered, not where it is raised (i18n.md §3). So what a
  // guest gets back is the key the client resolves, and the assertion below is that the
  // refusal names a known one rather than that it spells it out.
  expect(result.lastBody).toContain("errors.rateLimited");
  expect(result.lastBody).not.toMatch(/\bcause\b|postgres(?:ql)?:\/\/|Bearer\s|apiKeyEnc/i);
  for (const secret of [
    "e2e-key",
    "e2e-password-123",
    "e2e-secret-at-least-thirty-two-bytes",
    "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=",
  ]) {
    expect(result.lastBody).not.toContain(secret);
  }
});
