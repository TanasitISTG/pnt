import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "Father and Son at Dawn";
const chapterTitle = "黎明";
const draftNovelTitle = "Unpublished Draft at Noon";
const zhEnNovelTitle = "Father and Son in English";
const zhEnChapterTitle = "黎明（英文）";
const slowTranslationMarker = "慢速测试标记";
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
  await page.getByRole("tab", { name: "Add chapters" }).click();
  await page.getByLabel("Number *").fill("1");
  await page.getByLabel("Title *").last().fill(chapterTitle);
  await page.getByLabel("Raw Content *").fill("儿子对父亲说：“我会回来的。”\n父亲点了点头。");
  await page.getByRole("button", { name: "Add Chapter" }).click();
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();

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
  await expect(
    page
      .getByRole("combobox", { name: "Filter by publication" })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("All publication states");
  await expect(
    page.getByRole("combobox", { name: "Sort by" }).locator('[data-slot="select-value"]'),
  ).toHaveText("Newest first");
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
  await expect(page.getByText("“ผมจะ กลับมา” ลูกชายบอกพ่อ")).toBeVisible();
  await expect(page.getByText("return مرحبا мир")).toHaveCount(0);
  await expect(page.getByText("Machine-translated from Chinese.")).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/guest-reader.png", fullPage: true });
});
test("admin translates Chinese-to-English relationships and resets them on pair change", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto("/login");
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(zhEnNovelTitle);
  await page.locator("#sourceLang").click();
  await page.getByRole("option", { name: "Chinese (ZH)" }).click();
  await page.locator("#targetLang").click();
  await page.getByRole("option", { name: "English (EN)" }).click();
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: zhEnNovelTitle })).toBeVisible();
  await page.getByRole("tab", { name: "Add chapters" }).click();
  await page.getByLabel("Number *").fill("1");
  await page.getByLabel("Title *").last().fill(zhEnChapterTitle);
  await page
    .getByLabel("Raw Content *")
    .fill(`儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`);
  await page.getByRole("button", { name: "Add Chapter" }).click();
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByText("ZH → EN", { exact: true })).toBeVisible();
  await expect(page.getByText(/Chinese-to-English dialogue/)).toBeVisible();
  await page.getByRole("button", { name: "Add character profile" }).click();
  await expect(page.getByLabel("English name")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Back to novel" }).click();

  let chapterRow = page.getByRole("row", { name: new RegExp(zhEnChapterTitle) });
  await chapterRow.getByRole("button", { name: "Translate chapter" }).click();
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Novel actions" }).click();
  await page.getByRole("menuitem", { name: "Edit novel" }).click();
  await expect(page.getByRole("heading", { name: zhEnNovelTitle })).toBeVisible();
  const editUrl = page.url();
  await page.locator("#sourceLang").click();
  await page.getByRole("option", { name: "English (EN)" }).click();
  await page.locator("#targetLang").click();
  await page.getByRole("option", { name: "Thai (TH)" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByText("Cancel active translations before changing the language pair", { exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(editUrl);

  await page.getByRole("button", { name: "Go back" }).click();
  chapterRow = page.getByRole("row", { name: new RegExp(zhEnChapterTitle) });
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toHaveCount(0, {
    timeout: 90_000,
  });
  await expect(page.getByRole("link", { name: "Dawn", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: "Dawn", exact: true }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("radio", { name: "Translation" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(
    page.getByText('"I will return," Son said to Father.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(slowTranslationMarker, { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: zhEnNovelTitle })).toBeVisible();

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByText("Father", { exact: true })).toBeVisible();
  await expect(page.getByText("Son", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Directed relationships/ }).click();
  const generatedRelationshipRow = page
    .getByRole("row")
    .filter({ hasText: "儿子" })
    .filter({ hasText: "父亲" })
    .last();
  await expect(generatedRelationshipRow).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/relationships-zh-en.png", fullPage: true });

  await page.getByRole("button", { name: "Back to novel" }).click();
  await page.getByRole("button", { name: "Novel actions" }).click();
  await page.getByRole("menuitem", { name: "Edit novel" }).click();
  await page.locator("#sourceLang").click();
  await page.getByRole("option", { name: "English (EN)" }).click();
  await page.locator("#targetLang").click();
  await page.getByRole("option", { name: "Thai (TH)" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Novel updated successfully", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: zhEnNovelTitle })).toBeVisible();

  await page.getByRole("button", { name: "Relationships", exact: true }).click();
  await expect(page.getByText("EN → TH", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "No character profiles yet. The next translation or retranslation will generate this map, or you can add a profile manually.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Directed relationships/ }).click();
  await expect(
    page.getByText(
      "No directed relationships yet. They are generated from evidenced dialogue during the next translation or retranslation, or can be added manually.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("admin stops selected translations and reviews card metadata in both views", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const bulkNovelTitle = "Bulk Stop Translation";

  await page.goto("/login");
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(bulkNovelTitle);
  await page.locator("#sourceLang").click();
  await page.getByRole("option", { name: "Chinese (ZH)" }).click();
  await page.locator("#targetLang").click();
  await page.getByRole("option", { name: "English (EN)" }).click();
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: bulkNovelTitle })).toBeVisible();

  await page.getByRole("tab", { name: "Add chapters" }).click();
  const addChapter = async (number: number, title: string, content: string) => {
    await page.getByLabel("Number *").fill(String(number));
    await page.getByLabel("Title *").fill(title);
    await page.getByLabel("Raw Content *").fill(content);
    await page.getByRole("button", { name: "Add Chapter" }).click();
    await expect(
      page.getByText("Chapter added successfully", { exact: true }).first(),
    ).toBeVisible();
  };

  await addChapter(1, "Bulk chapter one", `儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`);
  await addChapter(2, "Bulk chapter two", `父亲点了点头。\n${slowTranslationMarker}`);
  await addChapter(3, "Idle chapter", "儿子在黎明时回家。");
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();

  const firstRow = page.getByRole("row", { name: /Bulk chapter one/ });
  const secondRow = page.getByRole("row", { name: /Bulk chapter two/ });
  const idleRow = page.getByRole("row", { name: /Idle chapter/ });
  await firstRow.getByRole("button", { name: "Translate chapter" }).click();
  await expect(firstRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 30_000,
  });
  await secondRow.getByRole("button", { name: "Translate chapter" }).click();
  await expect(secondRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 30_000,
  });

  await firstRow.getByRole("checkbox", { name: "Select chapter 1" }).check();
  await secondRow.getByRole("checkbox", { name: "Select chapter 2" }).check();
  await idleRow.getByRole("checkbox", { name: "Select chapter 3" }).check();
  await expect(page.getByRole("button", { name: "Stop selected (2)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Translate selected (1)" })).toBeVisible();

  await page.getByRole("button", { name: "Stop selected (2)" }).click();
  await expect(page.getByRole("heading", { name: "Stop selected translations?" })).toBeVisible();

  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Stop translations" }).click();
  await expect(page.getByRole("heading", { name: "Stop selected translations?" })).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: /failed|fetch|network|error/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("3/3 selected", { exact: true })).toBeVisible();
  await page.context().setOffline(false);

  await page.getByRole("button", { name: "Stop translations" }).click();
  await expect(page.getByRole("heading", { name: "Stop selected translations?" })).toBeHidden();
  await expect(firstRow.getByRole("button", { name: "Translate chapter" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(secondRow.getByRole("button", { name: "Translate chapter" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(idleRow.getByRole("checkbox", { name: "Select chapter 3" })).toBeChecked();
  await expect(page.getByText("1/3 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Translate selected (1)" })).toBeEnabled();

  await page.getByRole("button", { name: "Translate selected (1)" }).click();
  await expect(page.getByText(/Queued 1 chapter/, { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(idleRow.getByRole("checkbox", { name: "Select chapter 3" })).not.toBeChecked();

  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  const expectCardMetadata = async () => {
    const card = page.getByRole("link", { name: new RegExp(bulkNovelTitle) }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("Chapters", { exact: true })).toBeVisible();
    await expect(card.getByText("Translated", { exact: true })).toBeVisible();
    await expect(card.getByText("Publication", { exact: true })).toBeVisible();
    await expect(card.getByText("Draft", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("progressbar", { name: `${bulkNovelTitle} translation progress` }),
    ).toBeVisible();
  };

  await expectCardMetadata();
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectCardMetadata();
});
