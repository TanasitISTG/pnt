import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "Father and Son at Dawn";
const chapterTitle = "黎明";
const draftNovelTitle = "Unpublished Draft at Noon";
async function waitForReactHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const submit = document.querySelector('button[type="submit"]');
    return submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$"));
  });
}

async function rejectOptionalAnalytics(page: import("@playwright/test").Page) {
  const rejectButton = page.getByRole("button", { name: "Reject optional" });
  if (await rejectButton.isVisible()) await rejectButton.click();
}

async function waitForTransientToastsToClear(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

test("admin translates and publishes a chapter that a signed-out guest can read", async ({
  page,
}) => {
  await page.goto("/login");
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
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

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await page.getByRole("tab", { name: /Directed relationships/ }).click();
  const addRelationshipButton = page.getByRole("button", { name: "Add directed relationship" });
  await expect(addRelationshipButton).toBeDisabled();
  await expect(
    page.getByText("Add at least 2 character profiles first.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Characters/ }).click();
  await page.getByRole("button", { name: "Add character profile" }).click();
  await expect(page.getByRole("heading", { name: "Add character profile" })).toBeVisible();
  await page.getByRole("button", { name: "Save character" }).click();
  const sourceNameInput = page.getByLabel("Source name");
  await expect(sourceNameInput).toHaveAttribute("aria-invalid", "true");
  await expect(sourceNameInput).toHaveAttribute("aria-describedby", /character-source-error/);
  await expect(page.locator("#character-source-error")).toHaveAttribute("role", "alert");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Back to novel" }).click();

  const sourceChapterRow = page.getByRole("row", { name: new RegExp(chapterTitle) });
  await expect(sourceChapterRow).toBeVisible();
  await sourceChapterRow.getByRole("button", { name: "Translate chapter" }).click();

  const translatedTitle = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true });
  await expect(translatedTitle).toBeVisible({ timeout: 60_000 });
  const completionToast = page.getByText(/Translation: \d+ completed/);
  await expect(completionToast).toBeVisible({ timeout: 15_000 });
  await expect(completionToast).toBeHidden({ timeout: 15_000 });
  await waitForTransientToastsToClear(page);

  await page.getByRole("button", { name: "Glossary" }).click();
  await expect(page.getByRole("heading", { name: `${novelTitle} Glossary` })).toBeVisible();
  await page.getByRole("button", { name: "Bulk Import (TSV)" }).click();
  const glossaryImport = Array.from({ length: 26 }, (_, index) => {
    const number = index + 1;
    const label = String(number).padStart(2, "0");
    return `E2E Term ${label}\tเป้าหมาย ${label}\tother\tDeterministic fixture ${label}`;
  }).join("\n");
  await page.getByLabel("TSV Content").fill(glossaryImport);
  await page.getByRole("button", { name: "Import Terms" }).click();
  await expect(page.getByText("1–25 of 26 terms")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.getByText("E2E Term 26", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "First page" }).click();
  await page.getByRole("button", { name: "Add term" }).click();
  await expect(page.getByRole("heading", { name: "Add glossary term" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await waitForTransientToastsToClear(page);
  await page.screenshot({ path: ".tura/e2e/glossary-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const glossaryTableContainer = page.locator(
    'section[aria-label="Glossary terms"] [data-slot="table-container"]',
  );
  await expect(
    glossaryTableContainer.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).resolves.toBe(true);
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.screenshot({ path: ".tura/e2e/glossary-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Back to novel details" }).click();

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  const relationshipsTab = page.getByRole("tab", { name: /Directed relationships/ });
  await relationshipsTab.click();
  await expect(page.getByRole("heading", { name: "Directed relationships" })).toBeVisible();
  const relationshipPanel = page.locator('section[aria-labelledby="relationships-heading"]');
  await expect(relationshipPanel.getByText("儿子", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Self: —", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add directed relationship" })).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/relationships-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  const relationshipTableContainer = page.locator(
    'section[aria-labelledby="relationships-heading"] [data-slot="table-container"]',
  );
  await expect(
    relationshipTableContainer.getByRole("button", {
      name: "Actions for relationship 儿子 to 父亲",
    }),
  ).toBeVisible();
  await expect(
    relationshipTableContainer.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).resolves.toBe(true);
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.screenshot({ path: ".tura/e2e/relationships-mobile.png", fullPage: true });

  const relationshipRow = page
    .getByRole("row")
    .filter({ hasText: "儿子" })
    .filter({ hasText: "父亲" })
    .last();
  await expect(relationshipRow).toBeVisible();
  await relationshipRow
    .getByRole("button", { name: "Actions for relationship 儿子 to 父亲" })
    .click();
  await page.getByRole("menuitem", { name: "Disable" }).click();
  await expect(page.getByText("Relationship entry disabled", { exact: true })).toBeVisible();
  await expect(relationshipRow.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(relationshipRow.getByText("Auto-managed", { exact: true })).toBeVisible();
  await relationshipRow
    .getByRole("button", { name: "Actions for relationship 儿子 to 父亲" })
    .click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(page.getByText("Relationship entry restored", { exact: true })).toBeVisible();
  await expect(relationshipRow.getByText("Active", { exact: true })).toBeVisible();
  await expect(relationshipRow.getByText("Auto-managed", { exact: true })).toBeVisible();

  await relationshipRow
    .getByRole("button", { name: "Actions for relationship 儿子 to 父亲" })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit directed relationship" })).toBeVisible();
  await page.getByLabel("Preferred self-pronoun").fill("ผม");
  await page.getByRole("button", { name: "Save relationship" }).click();
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

  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(draftNovelTitle);
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: draftNovelTitle })).toBeVisible();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(draftNovelTitle) })).toBeVisible();

  await page.getByRole("button", { name: /E2E Admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Library", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(draftNovelTitle) })).toHaveCount(0);

  await page.getByRole("link", { name: new RegExp(novelTitle) }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByRole("link", { name: "ยามรุ่งอรุณ" }).click();

  await expect(page.getByRole("heading", { name: "ยามรุ่งอรุณ" })).toBeVisible();
  await expect(page.getByText("“ผมจะกลับมา” ลูกชายบอกพ่อ")).toBeVisible();
  await expect(page.getByText("Machine-translated from Chinese.")).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/guest-reader.png", fullPage: true });
});
