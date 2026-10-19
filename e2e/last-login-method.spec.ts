import { expect, test, type TestInfo } from "@playwright/test";

import { waitForHydration } from "./sessions";

/**
 * The sign-in page's memory of this browser, walked in a real page load.
 *
 * The value lives in a cookie the server reads while it renders, so the marker has to be in the
 * first HTML rather than appearing after hydration - which is exactly the part jsdom cannot
 * show. Presetting the cookie stands in for a previous sign-in: the suite's only real sign-in
 * runs in `global-setup.ts`, where the write side is asserted, and no OAuth provider is
 * configured here, so the button the hint would name cannot exist in this environment.
 */

const COOKIE = "better-auth.last_used_login_method";

function appURL(testInfo: TestInfo): string {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) {
    throw new Error(
      "The run has no baseURL, so a cookie cannot be scoped to the app origin; see playwright.config.ts.",
    );
  }
  return baseURL;
}

test("the sign-in page marks the method this browser used last", async ({ page }, testInfo) => {
  await page.context().addCookies([{ name: COOKIE, value: "email", url: appURL(testInfo) }]);

  await page.goto("/login");
  await waitForHydration(page);

  const marker = page.getByText("Last used", { exact: true });
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(marker).toBeVisible();
  // The field is still just "Email": the marker is a tag on the action, not part of a label.
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();

  // Pinned to the button's top-right corner: it overlaps the button rather than floating in a
  // row of its own above it, which is what makes it read as belonging to that control.
  const tagBox = await marker.boundingBox();
  const buttonBox = await submit.boundingBox();
  if (!tagBox || !buttonBox) throw new Error("The marker or the sign-in button was not rendered");
  expect(tagBox.y).toBeLessThan(buttonBox.y);
  expect(tagBox.y + tagBox.height).toBeGreaterThan(buttonBox.y);
  expect(tagBox.x + tagBox.width).toBeGreaterThan(buttonBox.x + buttonBox.width / 2);
});

test("a value this app does not offer marks nothing", async ({ page }, testInfo) => {
  // A stale cookie from a release that had another method, or one set by hand, names no control.
  await page.context().addCookies([{ name: COOKIE, value: "passkey", url: appURL(testInfo) }]);

  await page.goto("/login");
  await waitForHydration(page);

  await expect(page.getByText("Last used", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});
