import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "The Local Gate";
const chapterTitle = "Dawn at the Gate";

async function waitForReactHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const submit = document.querySelector('button[type="submit"]');
    return submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$"));
  });
}

test("admin translates and publishes a chapter that a signed-out guest can read", async ({
  page,
}) => {
  await page.goto("/login");
  await waitForReactHydration(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(novelTitle);

  await page.locator("#sourceLang").click();
  await page.getByRole("option", { name: "Chinese (ZH)" }).click();
  await page.locator("#targetLang").click();
  await page.getByRole("option", { name: "English (EN)" }).click();
  await page.getByRole("button", { name: "Create Novel" }).click();

  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByLabel("Number *").fill("1");
  await page.getByLabel("Title *").last().fill(chapterTitle);
  await page
    .getByLabel("Raw Content *")
    .fill("林在黎明时打开了旧门。\n\n门外，寂静的道路正在等待。 ");
  await page.getByRole("button", { name: "Add Chapter" }).click();

  const sourceChapterRow = page.getByRole("row", { name: new RegExp(chapterTitle) });
  await expect(sourceChapterRow).toBeVisible();
  await sourceChapterRow.getByRole("button", { name: "Translate chapter" }).click();

  const translatedTitle = page
    .getByRole("link", { name: "The Open Gate", exact: true })
    .filter({ visible: true });
  await expect(translatedTitle).toBeVisible({ timeout: 60_000 });
  const chapterRow = translatedTitle.locator("xpath=ancestor::tr");

  await page.getByRole("button", { name: "Novel publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(page.getByRole("button", { name: "Novel publishing options" })).toContainText(
    "Live",
  );

  await chapterRow.getByRole("button", { name: "Publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(chapterRow.getByRole("button", { name: "Publishing options" })).toContainText(
    "Live",
  );

  await page.getByRole("button", { name: /E2E Admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(novelTitle) }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByRole("link", { name: "The Open Gate" }).click();

  await expect(page.getByRole("heading", { name: "The Open Gate" })).toBeVisible();
  await expect(page.getByText("At dawn, Lin opened the old gate.")).toBeVisible();
  await expect(page.getByText("Machine-translated from Chinese.")).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/guest-reader.png", fullPage: true });
});
