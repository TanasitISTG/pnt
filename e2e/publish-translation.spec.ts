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

/**
 * Choose a language in one of the novel form's two pickers.
 *
 * Base UI keeps a closed Select mounted, so an unscoped `getByRole("option", …)` can also
 * match the *other* picker's copy of the same language — which is what a target picker sees
 * whenever the source picker lists the language too. The open select is the only one whose
 * trigger points at its list, so the option is addressed through `aria-controls`.
 */
async function selectLanguage(
  page: import("@playwright/test").Page,
  trigger: "#sourceLang" | "#targetLang",
  name: string,
) {
  const triggerLocator = page.locator(trigger);
  await triggerLocator.click();
  // Base UI writes `aria-controls` on the render after the click, and a just-closed
  // picker keeps a stale one, so wait for a live pointer at the open list.
  await expect(triggerLocator).toHaveAttribute("aria-controls", /./);
  const listId = await triggerLocator.getAttribute("aria-controls");
  if (!listId) throw new Error(`The ${trigger} picker did not open`);
  await page.locator(`#${listId}`).getByRole("option", { name }).click();
}

test("admin translates and publishes a chapter that a signed-out guest can read", async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await context.grantPermissions(["clipboard-write"], { origin: new URL(page.url()).origin });
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "New novel" }).click();
  await waitForReactHydration(page);
  await page.getByLabel("Title *").fill(novelTitle);

  await selectLanguage(page, "#sourceLang", "Chinese (ZH)");
  await selectLanguage(page, "#targetLang", "Thai (TH)");
  await page.getByRole("button", { name: "Create Novel" }).click();

  // Creating a novel opens its studio on the add-chapters section; the reading page is a
  // separate URL that the trail links to.
  await expect(page.getByRole("heading", { name: "Add chapters" })).toBeVisible();
  const novelDetailUrl = `/novels/${new URL(page.url()).pathname.split("/")[2]}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Chapter number *").fill("1");
  await page.getByLabel("Chapter title *").fill(chapterTitle);
  await page.getByLabel("Source text *").fill("儿子对父亲说：“我会回来的。”\n父亲点了点头。");

  await page.getByRole("tab", { name: /^From URL/ }).click();
  await page.getByLabel("Chapter source URL").fill("https://www.quanben.io/n/test/1.html");
  await page.getByRole("spinbutton", { name: "First chapter" }).fill("1");
  await page.getByRole("spinbutton", { name: "Last chapter" }).fill("5");

  await page.getByRole("tab", { name: /^EPUB file/ }).click();
  await page.locator('input[type="file"][accept*=".epub"]').setInputFiles({
    name: "retained-draft.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from("draft"),
  });

  await page.getByRole("tab", { name: /^From URL/ }).click();
  await expect(page.getByLabel("Chapter source URL")).toHaveValue(
    "https://www.quanben.io/n/test/1.html",
  );
  await expect(page.getByRole("spinbutton", { name: "Last chapter" })).toHaveValue("5");
  await page.getByRole("tab", { name: /^EPUB file/ }).click();
  await expect(page.getByText(/retained-draft\.epub/)).toBeVisible();
  await page.getByRole("tab", { name: /^Paste text/ }).click();
  await expect(page.getByLabel("Chapter number *")).toHaveValue("1");
  await expect(page.getByLabel("Chapter title *")).toHaveValue(chapterTitle);
  await expect(page.getByLabel("Source text *")).toHaveValue(
    "儿子对父亲说：“我会回来的。”\n父亲点了点头。",
  );
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("link", { name: "Chapters", exact: true }).click();

  await page.getByRole("link", { name: "Relationships", exact: true }).click();
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
  await page.getByRole("link", { name: "Chapters", exact: true }).click();

  const sourceChapterRow = page.getByRole("row", { name: new RegExp(chapterTitle) });
  await expect(sourceChapterRow).toBeVisible();
  await sourceChapterRow.getByRole("button", { name: "Translate chapter" }).click();

  const translatedTitle = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true });
  await expect(translatedTitle).toBeVisible({ timeout: 60_000 });
  const completionToast = page.getByText(/Translation: \d+ completed/);
  await expect(completionToast).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Job activity" })).toBeVisible();
  const mobileJobHistory = page.getByRole("region", { name: "Mobile job history" });
  await expect(mobileJobHistory).toBeVisible();
  const translatedJobCard = mobileJobHistory
    .locator("article")
    .filter({ hasText: novelTitle })
    .filter({ hasText: chapterTitle });
  await expect(translatedJobCard).toBeVisible();
  await expect(translatedJobCard.getByText("Runtime · openai · e2e-model")).toBeVisible();
  const copyJobIdButton = translatedJobCard.getByRole("button", { name: "Copy job ID" });
  await expect(copyJobIdButton).toBeVisible();
  await expect(translatedJobCard.getByRole("button", { name: "Details" })).toBeVisible();
  await expect(translatedJobCard.getByRole("button", { name: "Novel" })).toBeVisible();
  await expect(translatedJobCard.getByRole("button", { name: "Chapter" })).toBeVisible();
  const copyJobIdBounds = await copyJobIdButton.boundingBox();
  expect(copyJobIdBounds).not.toBeNull();
  expect(copyJobIdBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await copyJobIdButton.click();
  await expect(page.getByText("Job ID copied")).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(novelDetailUrl);
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  await page.getByRole("button", { name: "Manage" }).click();
  // Addressed through the studio's sub-nav: the progress card also links to the glossary.
  await page
    .getByRole("navigation", { name: "Novel studio" })
    .getByRole("link", { name: "Glossary" })
    .click();
  await expect(page.getByRole("heading", { name: `${novelTitle} Glossary` })).toBeVisible();
  const bulkImportButton = page.getByRole("button", { name: "Bulk Import (TSV)" });
  await expect
    .poll(() =>
      bulkImportButton.evaluate((button) =>
        Object.keys(button).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
  await bulkImportButton.click();
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
  await expect(
    page.getByLabel("Desktop glossary terms").getByText("E2E Term 26", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "First page" }).click();
  await page.getByRole("button", { name: "Add term" }).click();
  await expect(page.getByRole("heading", { name: "Add glossary term" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await waitForTransientToastsToClear(page);
  await page.screenshot({ path: ".tura/e2e/glossary-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const glossaryMobileRows = page.getByRole("region", { name: "Mobile glossary terms" });
  await expect(glossaryMobileRows).toBeVisible();
  await expect(glossaryMobileRows.getByText("E2E Term 01", { exact: true })).toBeVisible();
  await expect(glossaryMobileRows.getByRole("button", { name: "Edit" }).first()).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.screenshot({ path: ".tura/e2e/glossary-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
  const relationshipsTab = page.getByRole("tab", { name: /Directed relationships/ });
  await relationshipsTab.click();
  await expect(page.getByRole("heading", { name: "Directed relationships" })).toBeVisible();
  const relationshipPanel = page.getByLabel("Desktop directed relationships");
  await expect(relationshipPanel.getByText("儿子", { exact: true })).toBeVisible();
  await expect(relationshipPanel.getByText("Self: —", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add directed relationship" })).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/relationships-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  const relationshipMobileRows = page.getByRole("region", {
    name: "Mobile directed relationships",
  });
  await expect(relationshipMobileRows).toBeVisible();
  await expect(
    relationshipMobileRows.getByRole("button", {
      name: "Actions for relationship 儿子 to 父亲",
    }),
  ).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
  await page.screenshot({ path: ".tura/e2e/relationships-mobile.png", fullPage: true });

  const relationshipRow = relationshipMobileRows
    .locator("article")
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
  await expect(relationshipMobileRows.getByText(/ผม/)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Chapters", exact: true }).click();
  const chapterRow = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true })
    .locator("xpath=ancestor::tr");
  await chapterRow.getByRole("button", { name: "Re-translate chapter" }).click();
  await expect(
    page.getByRole("heading", { name: "Overwrite Existing Translation?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overwrite & Translate" }).click();
  const activeRetranslation = chapterRow.getByRole("button", { name: "Cancel translation" });
  await expect(activeRetranslation).toBeVisible({ timeout: 30_000 });
  await expect(activeRetranslation).toHaveCount(0, { timeout: 90_000 });
  await expect(
    page.getByRole("link", { name: "ยามรุ่งอรุณ", exact: true }).filter({ visible: true }),
  ).toBeVisible({ timeout: 60_000 });

  // The publish menus animate out, so a just-closed menu keeps its items in the DOM for a
  // frame or two: address an item through the menu it belongs to, because the novel chip and
  // a chapter row both offer "Publish now".
  await page.getByRole("button", { name: "Novel publishing options" }).click();
  await page
    .getByRole("menu", { name: "Novel publishing options" })
    .getByRole("menuitem", { name: "Publish now" })
    .click();
  await expect(page.getByRole("button", { name: "Novel publishing options" })).toContainText(
    "Live",
  );

  const translatedChapterRow = page
    .getByRole("link", { name: "ยามรุ่งอรุณ", exact: true })
    .filter({ visible: true })
    .locator("xpath=ancestor::tr");
  await translatedChapterRow.getByRole("button", { name: "Publishing options" }).click();
  await page
    .getByRole("menu", { name: "Publishing options", exact: true })
    .getByRole("menuitem", { name: "Publish now" })
    .click();
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
  await page.getByRole("button", { name: "New novel" }).click();
  await waitForReactHydration(page);
  await page.getByLabel("Title *").fill(draftNovelTitle);
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: "Add chapters" })).toBeVisible();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(draftNovelTitle) })).toBeVisible();

  await page.getByRole("button", { name: /E2E Admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  // Signing out from the shelf lands a guest on `/`, which serves the shared catalog:
  // published novels only, and none of the owner affordances.
  await expect(page.getByRole("heading", { name: "Catalog", exact: true })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "New novel" }).click();
  await waitForReactHydration(page);
  await page.getByLabel("Title *").fill(zhEnNovelTitle);
  await selectLanguage(page, "#sourceLang", "Chinese (ZH)");
  await selectLanguage(page, "#targetLang", "English (EN)");
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: "Add chapters" })).toBeVisible();
  await page.getByLabel("Chapter number *").fill("1");
  await page.getByLabel("Chapter title *").fill(zhEnChapterTitle);
  await page
    .getByLabel("Source text *")
    .fill(`儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("link", { name: "Chapters", exact: true }).click();

  await page.getByRole("link", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByText("ZH → EN", { exact: true })).toBeVisible();
  await expect(page.getByText(/Chinese-to-English dialogue/)).toBeVisible();
  await page.getByRole("button", { name: "Add character profile" }).click();
  await expect(page.getByLabel("English name")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("link", { name: "Chapters", exact: true }).click();

  let chapterRow = page.getByRole("row", { name: new RegExp(zhEnChapterTitle) });
  await chapterRow.getByRole("button", { name: "Translate chapter" }).click();
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Novel settings" })).toBeVisible();
  const editUrl = page.url();
  await selectLanguage(page, "#sourceLang", "English (EN)");
  await selectLanguage(page, "#targetLang", "Thai (TH)");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByText("Cancel active translations before changing the language pair", { exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(editUrl);

  await page.getByRole("link", { name: "Chapters", exact: true }).click();
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
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Translation" })
    .click();
  // The appearance popover has no close button: its trigger toggles it, as it opened it.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("group", { name: "View" })).toHaveCount(0);
  await expect(
    page.getByText('"I will return," Son said to Father.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(slowTranslationMarker, { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Chapters", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Relationships", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(
    page.getByLabel("Desktop character profiles").getByText("Father", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Desktop character profiles").getByText("Son", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Directed relationships/ }).click();
  const generatedRelationshipRow = page
    .getByRole("row")
    .filter({ hasText: "儿子" })
    .filter({ hasText: "父亲" })
    .last();
  await expect(generatedRelationshipRow).toBeVisible();
  await page.screenshot({ path: ".tura/e2e/relationships-zh-en.png", fullPage: true });

  await page.getByRole("link", { name: "Settings" }).click();
  await selectLanguage(page, "#sourceLang", "English (EN)");
  await selectLanguage(page, "#targetLang", "Thai (TH)");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Novel updated successfully", { exact: true })).toBeVisible();
  // Saving stays on the settings section instead of leaving the studio.
  await expect(page.getByRole("heading", { name: "Novel settings" })).toBeVisible();

  await page.getByRole("link", { name: "Relationships", exact: true }).click();
  await expect(page.getByText("EN → TH", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Desktop character profiles")
      .getByText(
        "No character profiles yet. The next translation or retranslation will generate this map, or you can add a profile manually.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Directed relationships/ }).click();
  await expect(
    page
      .getByLabel("Desktop directed relationships")
      .getByText(
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

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "New novel" }).click();
  await waitForReactHydration(page);
  await page.getByLabel("Title *").fill(bulkNovelTitle);
  await selectLanguage(page, "#sourceLang", "Chinese (ZH)");
  await selectLanguage(page, "#targetLang", "English (EN)");
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: "Add chapters" })).toBeVisible();

  const addChapter = async (number: number, title: string, content: string) => {
    await page.getByLabel("Chapter number *").fill(String(number));
    await page.getByLabel("Chapter title *").fill(title);
    await page.getByLabel("Source text *").fill(content);
    await page.getByRole("button", { name: "Add chapter" }).click();
    await expect(
      page.getByText("Chapter added successfully", { exact: true }).first(),
    ).toBeVisible();
  };

  await addChapter(1, "Bulk chapter one", `儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`);
  await addChapter(2, "Bulk chapter two", `父亲点了点头。\n${slowTranslationMarker}`);
  await addChapter(3, "Idle chapter", "儿子在黎明时回家。");
  await page.getByRole("link", { name: "Chapters", exact: true }).click();

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
  // The shelf card the redesign ships: named link, the pair as one phrase, one publication
  // state, one progress statement. The old "Chapters"/"Translated"/"Publication" rows are
  // deliberately gone, so grepping for them would test the retired card.
  const expectCardMetadata = async () => {
    const card = page.getByRole("link", { name: new RegExp(bulkNovelTitle) }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText("ZH to EN", { exact: true })).toHaveCount(1);
    await expect(card.getByText("Draft", { exact: true })).toBeVisible();
    await expect(card.getByText(/^\d+\/\d+ · \d+%$/)).toBeVisible();
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
