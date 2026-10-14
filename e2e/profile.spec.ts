import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";

const adminId = "e2e-admin";
const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const seededName = "E2E Admin";
const renamedTo = "E2E Curator";

async function waitForReactHydration(page: Page, selector = 'button[type="submit"]') {
  await page.waitForFunction((target) => {
    const node = document.querySelector(target);
    return Boolean(node && Object.keys(node).some((key) => key.startsWith("__reactProps$")));
  }, selector);
}

async function rejectOptionalAnalytics(page: Page) {
  const rejectButton = page.getByRole("button", { name: "Reject optional" });
  if (await rejectButton.isVisible()) await rejectButton.click();
}

async function signIn(page: Page) {
  await page.goto("/login");
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The account's front door is the reading home; the shelf is its own page.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
}

/** The account trigger carries only the photo, so an empty locator means no photo. */
function headerAvatar(page: Page, accountName = seededName) {
  return page.getByRole("button", { name: new RegExp(accountName) }).locator("img");
}

async function saveName(page: Page, next: string) {
  // Typing before hydration only writes the DOM: React then replaces the value with
  // its own state and the form submits the old name.
  await waitForReactHydration(page);
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
    await sql`UPDATE "user" SET "name" = ${seededName}, "image" = NULL WHERE "id" = ${adminId}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("the account section owns the display name and photo", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);

  // The account menu offers Account, which opens the settings hub's account section.
  await page.getByRole("button", { name: new RegExp(seededName) }).click();
  await expect(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();
  // Exact: the change-email form on the same page also carries an "Email" label.
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(adminEmail);

  // The bare hub opens on the same section, and the sections are real destinations
  // rather than one page's worth of stacked cards.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/account$/);
  await waitForReactHydration(page, 'a[href="/settings/security"]');
  await page.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  await expect(page.getByRole("heading", { level: 2, name: "Security" })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Account" })).toBeVisible();

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

  await waitForReactHydration(page);
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
  await saveName(page, seededName);
  await expect(headerAvatar(page)).toHaveCount(0);
});
