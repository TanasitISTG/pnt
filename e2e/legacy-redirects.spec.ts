import { expect, test } from "@playwright/test";

import { createNovel } from "./novels";
import { takeSession } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

/**
 * The redesign moved the shared shelf, the owner's editor and the two novel maps to new URLs
 * and promised every old address keeps working. A redirect is only as good as the address
 * that reaches it, so this spec walks the legacy paths — query strings included — rather than
 * trusting that the redirect files exist.
 */
test("legacy addresses redirect into the redesigned app", async ({ page }) => {
  test.setTimeout(120_000);

  // The guest-visible move: `/browse` was the shared catalog before `/catalog` existed, and a
  // reader's filters travel with the link.
  await page.goto("/browse?q=dawn&sort=title");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/catalog" &&
      url.searchParams.get("q") === "dawn" &&
      url.searchParams.get("sort") === "title",
  );
  await expect(page.getByRole("heading", { name: "Catalog", exact: true })).toBeVisible();

  // The rest of this spec walks an owner's addresses, and its session comes from the fixture
  // (`e2e/sessions.ts`).

  // Settings became a hub of its own sections. The old account page and the bare hub both
  // land on the section the hub opens with.
  await page.goto("/profile");
  await expect(page).toHaveURL((url) => url.pathname === "/settings/account");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();

  await page.goto("/settings");
  await expect(page).toHaveURL((url) => url.pathname === "/settings/account");

  // A novel of this spec's own, so the studio redirects are walked by an owner who can see them:
  // creating one hands back the id every address below is built from.
  // The control lives on the reading home and the shelf, not in the settings hub this spec
  // has just walked, so the flow comes back to the home screen to reach it.
  await page.goto("/");
  const novelTitle = `Legacy addresses ${Date.now()}`;
  const novelId = await createNovel(page, { title: novelTitle });

  await page.goto(`/novels/${novelId}/edit`);
  await expect(page).toHaveURL((url) => url.pathname === `/novels/${novelId}/manage/settings`);
  await expect(page.getByRole("heading", { name: "Novel settings" })).toBeVisible();

  // The maps keep which tab, filter and page the viewer was on.
  await page.goto(`/novels/${novelId}/glossary?q=gate&page=2`);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/novels/${novelId}/manage/glossary` &&
      url.searchParams.get("q") === "gate" &&
      url.searchParams.get("page") === "2",
  );
  await expect(page.getByRole("heading", { level: 1, name: /Glossary$/ })).toBeVisible();

  await page.goto(`/novels/${novelId}/relationships?q=mother&page=2`);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/novels/${novelId}/manage/relationships` &&
      url.searchParams.get("q") === "mother" &&
      url.searchParams.get("page") === "2",
  );
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
});
