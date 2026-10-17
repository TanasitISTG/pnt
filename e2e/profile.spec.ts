import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

import { claimShared, readShared } from "./fixtures";
import { openReadingHome, takeSession, waitForHydration } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

/** The operator whose stored profile this spec is the one spec allowed to change. */
const admin = readShared("admin-account");
const renamedTo = "E2E Curator";

/**
 * Sets the language of the signed-in work areas for the next document request.
 *
 * `/settings` is one of them: a work area carries no locale prefix, so its language comes
 * from the `pnt-locale` cookie - what `use-switch-locale` writes - and the account's own
 * remembered locale sits behind it. Only the cookie is touched: the remembered value is not a
 * spec's to change (`SHARED`, `e2e/fixtures.ts`).
 */
async function setLocaleCookie(page: Page, locale: "en" | "th") {
  await page
    .context()
    .addCookies([{ name: "pnt-locale", value: locale, url: new URL(page.url()).origin }]);
}

/** The account trigger carries only the photo, so an empty locator means no photo. */
function headerAvatar(page: Page, accountName: string = admin.name) {
  return page.getByRole("button", { name: new RegExp(accountName) }).locator("img");
}

async function saveName(page: Page, next: string) {
  // Typing before hydration only writes the DOM: React then replaces the value with
  // its own state and the form submits the old name.
  await waitForHydration(page);
  await page.getByLabel("Display Name").fill(next);
  await page.getByRole("button", { name: "Save Changes" }).click();
  // The shell renders the name from the router context, so this also proves the
  // profile change invalidated it.
  await expect(page.getByRole("button", { name: new RegExp(next) })).toBeVisible();
}

test.afterEach(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    // Restore the seeded profile rather than trusting the UI to have done it: the
    // name and photo have to be as found for the specs that run after this file.
    await sql`UPDATE "user" SET "name" = ${admin.name}, "image" = NULL WHERE "id" = ${admin.id}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("the account section owns the display name and photo", async ({ page }) => {
  test.setTimeout(120_000);
  await openReadingHome(page);

  // The account menu offers Account, which opens the settings hub's account section.
  await page.getByRole("button", { name: new RegExp(admin.name) }).click();
  await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();
  // Exact: the change-email form on the same page also carries an "Email" label.
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(admin.email);

  // The bare hub opens on the same section, and the sections are real destinations
  // rather than one page's worth of stacked cards.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/account$/);
  await waitForHydration(page.getByRole("link", { name: "Security" }));
  await page.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole("heading", { level: 2, name: "Security" })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();

  // Everything below changes what the header shows for the seeded account - the name every other
  // spec clicks by - and puts it back before the test ends. The claim is the declaration's
  // (`SHARED`, `e2e/fixtures.ts`), and this is the only place in the run that takes it.
  claimShared("admin-account", "change", "profile");

  await saveName(page, renamedTo);

  // The rename is durable, not just re-rendered state.
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(renamedTo) })).toBeVisible();
  await expect(page.getByLabel("Display Name")).toHaveValue(renamedTo);

  const source = await sharp({
    create: {
      width: 600,
      height: 900,
      channels: 4,
      background: { r: 180, g: 70, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  await waitForHydration(page);
  await page.setInputFiles('input[aria-label="Profile photo file"]', {
    name: "profile.png",
    mimeType: "image/png",
    buffer: source,
  });

  // Choosing a file stages it: the crop is shown for confirmation, and neither the
  // server nor the shell has seen the new photo yet.
  await expect(page.getByRole("group", { name: /Adjust the photo/ })).toBeVisible();
  await expect(page.getByText("Profile photo updated")).toHaveCount(0);
  await expect(headerAvatar(page, renamedTo)).toHaveCount(0);

  await page.getByRole("button", { name: "Save photo" }).click();
  await expect(page.getByText("Profile photo updated").last()).toBeVisible();

  // The shell renders the stored photo; the URL is the CDN when this environment
  // configures a public bucket, and the app's own route when it does not.
  const avatar = headerAvatar(page, renamedTo);
  await expect(avatar).toBeVisible();
  const src = await avatar.getAttribute("src");
  expect(src).toMatch(/(^|\/)avatars\//);

  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");

  // Square, proving the browser-side center crop ran before the upload.
  const metadata = await sharp(await response.body()).metadata();
  expect(metadata.width).toBe(metadata.height);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Profile photo removed").last()).toBeVisible();
  // Back to the initials from the current name, and the objects are gone.
  await expect(page.getByText("EC").first()).toBeVisible();
  await expect(headerAvatar(page, renamedTo)).toHaveCount(0);

  // Leave the seeded name behind for the specs that click it.
  await saveName(page, admin.name);
  await expect(headerAvatar(page)).toHaveCount(0);

  // The settings hub in Thai, at phone width: the section nav, the two headings and the form
  // labels are all keyed copy, and this is the one screen every account visits.
  await page.setViewportSize({ width: 390, height: 844 });
  await setLocaleCookie(page, "th");
  await page.goto("/settings/account");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { level: 1, name: "การตั้งค่า" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "บัญชี" })).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
});
