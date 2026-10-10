import { expect, test } from "@playwright/test";

// Only the replay requests carry this identity; navigation and other specs cannot
// consume its window. No account or novel fixture is required by listNovels.
const guestIp = "203.0.113.61";

test("guest listNovels returns a safe HTTP 429 on request 61", async ({ page }, testInfo) => {
  await page.goto("/privacy");
  await page.waitForFunction(() => {
    const link = Array.from(document.querySelectorAll("a")).find(
      (element) => element.textContent?.trim() === "Library",
    );
    return link && Object.keys(link).some((key) => key.startsWith("__reactProps$"));
  });
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
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
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
  headers["x-forwarded-for"] = guestIp;
  const result = await page.evaluate(
    async ({ endpoint, headers }) => {
      const startedAt = performance.now();
      const statuses: number[] = [];
      let lastBody = "";
      for (let index = 0; index < 61; index++) {
        const response = await fetch(endpoint, {
          method: "GET",
          headers,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        });
        statuses.push(response.status);
        lastBody = await response.text();
      }
      return { statuses, lastBody, elapsedMs: performance.now() - startedAt };
    },
    { endpoint, headers },
  );

  expect(result.elapsedMs, "all requests must remain within one fixed window").toBeLessThan(60_000);
  expect(result.statuses.slice(0, 60)).toEqual(Array<number>(60).fill(200));
  expect(result.statuses[60]).toBe(429);
  expect(result.lastBody).toContain("Too many requests");
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
