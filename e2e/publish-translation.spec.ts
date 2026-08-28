import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "Father and Son at Dawn";
const chapterTitle = "黎明";
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
  await page.getByRole("option", { name: "Thai (TH)" }).click();
  await page.getByRole("button", { name: "Create Novel" }).click();

  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByLabel("Number *").fill("1");
  await page.getByLabel("Title *").last().fill(chapterTitle);
  await page.getByLabel("Raw Content *").fill("儿子对父亲说：“我会回来的。”\n父亲点了点头。");
  await page.getByRole("button", { name: "Add Chapter" }).click();

  const sourceChapterRow = page.getByRole("row", { name: new RegExp(chapterTitle) });
  await expect(sourceChapterRow).toBeVisible();
  await sourceChapterRow.getByRole("button", { name: "Translate chapter" }).click();

  const translatedTitle = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true });
  await expect(translatedTitle).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Directed relationships" })).toBeVisible();
  await expect(page.getByText("Auto-managed").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "儿子", exact: true })).toBeVisible();
  await expect(page.getByText("“儿子”", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Self: ฉัน", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add character profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add directed relationship" })).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/relationships-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.screenshot({ path: ".tura/e2e/relationships-mobile.png", fullPage: true });

  await page.getByRole("button", { name: /Edit relationship 儿子 to 父亲/ }).click();
  await page.getByLabel("Preferred self-pronoun").fill("ผม");
  await page.getByRole("button", { name: "Save relationship" }).click();
  await expect(page.getByText("Manual").first()).toBeVisible();
  await expect(page.getByText("Self: ผม", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Back to novel" }).click();
  const chapterRow = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true })
    .locator("xpath=ancestor::tr");
  await chapterRow.getByRole("button", { name: "Re-translate chapter" }).click();
  const activeRetranslation = chapterRow.getByRole("button", { name: "Cancel translation" });
  await expect(activeRetranslation).toBeVisible({ timeout: 30_000 });
  await expect(activeRetranslation).toHaveCount(0, { timeout: 90_000 });
  await expect(
    page.getByRole("link", { name: "ยามรุ่งอรุณ", exact: true }).filter({ visible: true }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Novel publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(page.getByRole("button", { name: "Novel publishing options" })).toContainText(
    "Live",
  );

  const translatedChapterRow = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true })
    .locator("xpath=ancestor::tr");
  await translatedChapterRow.getByRole("button", { name: "Publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(
    translatedChapterRow.getByRole("button", { name: "Publishing options" }),
  ).toContainText("Live");

  await page.getByRole("button", { name: /E2E Admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(novelTitle) }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByRole("link", { name: "ยามรุ่งอรุณ" }).click();

  await expect(page.getByRole("heading", { name: "ยามรุ่งอรุณ" })).toBeVisible();
  await expect(page.getByText("“ผมจะกลับมา” ลูกชายบอกพ่อ")).toBeVisible();
  await expect(page.getByText("Machine-translated from Chinese.")).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/guest-reader.png", fullPage: true });
});
