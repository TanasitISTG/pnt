import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { readShared } from "./fixtures";
import {
  addChapter,
  appearanceGroup,
  closeReaderAppearance,
  createNovel,
  fillChapterForm,
  openChapter,
  openReaderAppearance,
  selectLanguage,
  studioSection,
} from "./novels";
import { openReadingHome, takeSession, waitForHydration } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

const appUrl = readShared("app").url;
const novelTitle = "Father and Son at Dawn";
const chapterTitle = "黎明";
const draftNovelTitle = "Unpublished Draft at Noon";
const zhEnNovelTitle = "Father and Son in English";
const zhEnChapterTitle = "黎明（英文）";
const slowTranslationMarker = "慢速测试标记";
/**
 * Switches the language of the signed-in work areas for the next document request.
 *
 * They carry no locale prefix - `/jobs`, `/admin` and a novel's studio paths are deliberately
 * unshared and unindexed - so their language comes from the `pnt-locale` cookie, exactly as
 * `use-switch-locale` sets it for a reader who picks one. The account's own remembered locale
 * is the fallback behind the cookie, and it is not a spec's to change (`SHARED`,
 * `e2e/fixtures.ts`): a switch made as that account would decide the language of every spec
 * that runs afterwards.
 */
async function setLocaleCookie(page: import("@playwright/test").Page, locale: "en" | "th") {
  await page
    .context()
    .addCookies([{ name: "pnt-locale", value: locale, url: new URL(page.url()).origin }]);
}

async function waitForTransientToastsToClear(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

test("admin translates and publishes a chapter that a signed-out guest can read", async ({
  browser,
  context,
  page,
}) => {
  test.setTimeout(180_000);
  // The copy-to-clipboard toast is one of the things this test reads, and the permission belongs
  // to the context rather than to a page: granted up front, it survives every navigation below.
  await context.grantPermissions(["clipboard-write"], { origin: appUrl });
  await openReadingHome(page);
  // The reading page is a separate address the trail links to, and the creation hands back the id
  // it is built from.
  const novelId = await createNovel(page, {
    title: novelTitle,
    pair: { source: "Chinese (ZH)", target: "Thai (TH)" },
  });
  const novelDetailUrl = `/novels/${novelId}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await fillChapterForm(page, {
    number: "1",
    title: chapterTitle,
    source: "儿子对父亲说：“我会回来的。”\n父亲点了点头。",
  });

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
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await studioSection(page, "Chapters").click();

  // Kept for the Thai sweep near the end of this test, which visits this workspace again.
  const chaptersPath = new URL(page.url()).pathname;

  await studioSection(page, "Relationships").click();
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
  await studioSection(page, "Chapters").click();

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
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
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
  // Addressed through the studio's sub-nav, whose helper says why: the progress card also links
  // to the glossary.
  await studioSection(page, "Glossary").click();
  await expect(page.getByRole("heading", { name: `${novelTitle} Glossary` })).toBeVisible();
  const bulkImportButton = page.getByRole("button", { name: "Bulk Import (TSV)" });
  await waitForHydration(bulkImportButton);
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

  // Kept for the Thai sweep near the end of this test, which visits the glossary again.
  const glossaryPath = new URL(page.url()).pathname;

  await page.setViewportSize({ width: 1280, height: 900 });
  await studioSection(page, "Relationships").click();
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
  await studioSection(page, "Chapters").click();
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

  // The export menu is the owner's way out of the app with the book. The unit suite proves the
  // route it asks for and the sentence it shows when there is nothing to export; this proves
  // the file: the browser receives a download whose body is the translation on the page above.
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Export as TXT/ }).click();
    })(),
  ]);
  expect(exported.suggestedFilename()).toBe(`${novelTitle}.txt`);
  const exportedPath = await exported.path();
  if (!exportedPath) throw new Error("the export download was saved nowhere to read");
  expect(readFileSync(exportedPath, "utf8")).toContain("ผมจะ กลับมา");

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
  // The shelf offers the control itself, which is where this spec is standing.
  await createNovel(page, { title: draftNovelTitle });
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(draftNovelTitle) })).toBeVisible();

  // The five signed-in surfaces this test has just visited, once more in the language the app
  // actually ships in and at the width where each is tightest.
  //
  // A work area carries no language in its URL on purpose (`IGNORED_EXACT_PATHS` in
  // `src/lib/i18n/locales.ts`: these pages are neither shared nor indexed), so Thai here comes
  // from the `pnt-locale` cookie - what the switcher writes - and the account's remembered
  // locale is only its fallback. That is why nothing below has to change `user.locale`, the
  // shared state every other spec in the run asserts English copy against. And no unit test can
  // stand in for it: jsdom has no layout engine, and Thai runs longer than English per wrapped
  // line, in these very controls - a job's ID button, a status badge, a column header.
  const thaiSurfaces = [
    { path: "/library", heading: "คลังของฉัน" },
    {
      path: "/jobs",
      heading: "ความเคลื่อนไหว",
      control: { role: "button", name: "คัดลอกรหัสงาน" },
    },
    { path: chaptersPath, heading: "บท" },
    { path: glossaryPath, heading: `อภิธานศัพท์ของ ${novelTitle}` },
    { path: `${novelDetailUrl}/relationships`, heading: "ตัวละครและความสัมพันธ์" },
  ] as const;

  await page.setViewportSize({ width: 390, height: 844 });
  await setLocaleCookie(page, "th");
  for (const surface of thaiSurfaces) {
    await page.goto(surface.path);
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    // Exact, like the catalog's own heading: a surface is named by its whole heading, so a
    // heading that merely contains these words is not the surface this test visited.
    await expect(page.getByRole("heading", { name: surface.heading, exact: true })).toBeVisible();
    if ("control" in surface) {
      await expect(
        page.getByRole(surface.control.role, { name: surface.control.name }).first(),
      ).toBeVisible();
    }
    await expect(
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).resolves.toBe(true);
  }

  // The rest of this test is what a reader sees *after* the owner leaves, and signing out ends
  // the session it is given - so it runs in a context with a session of its own, declared as this
  // spec's to end (`SESSIONS` in `e2e/sessions.ts`). The shared one stays alive for the two tests
  // below, and for `reader-smoke.spec.ts` and `reports.spec.ts`, which run after this file.
  const guestContext = await browser.newContext({
    storageState: takeSession("publish-translation", "sign-out"),
  });
  try {
    const guest = await guestContext.newPage();

    // The shelf the sign-out step expects: signing out of a protected page would land on the
    // sign-in screen, and what follows is the guest's catalogue.
    await guest.setViewportSize({ width: 1280, height: 900 });
    await guest.goto("/library");
    await expect(guest.getByRole("heading", { name: "Your Library" })).toBeVisible();

    // A document load renders the account menu's button a moment before React attaches its
    // handlers - a click that lands first only focuses it, and the menu never opens. So the
    // click is retried until the menu answers.
    await expect(async () => {
      await guest.getByRole("button", { name: /E2E Admin/ }).click();
      await expect(guest.getByRole("menuitem", { name: "Sign out" })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });
    await guest.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(guest.getByRole("button", { name: "Sign in" })).toBeVisible();
    // Signing out from the shelf lands a guest on `/`, which serves the shared catalog:
    // published novels only, and none of the owner affordances.
    await expect(guest.getByRole("heading", { name: "Catalog", exact: true })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Your Library", exact: true })).toHaveCount(0);
    await expect(guest.getByRole("link", { name: new RegExp(novelTitle) })).toBeVisible();
    await expect(guest.getByRole("link", { name: new RegExp(draftNovelTitle) })).toHaveCount(0);

    await guest.getByRole("link", { name: new RegExp(novelTitle) }).click();
    await expect(guest.getByRole("heading", { name: novelTitle })).toBeVisible();
    await guest.getByRole("link", { name: "ยามรุ่งอรุณ" }).click();

    await expect(guest.getByRole("heading", { name: "ยามรุ่งอรุณ" })).toBeVisible();
    await expect(guest.getByText("“ผมจะ กลับมา” ลูกชายบอกพ่อ")).toBeVisible();
    await expect(guest.getByText("return مرحبا мир")).toHaveCount(0);
    await expect(guest.getByText("Machine-translated from Chinese.")).toBeVisible();
    await guest.screenshot({ path: ".tura/e2e/guest-reader.png", fullPage: true });
  } finally {
    await guestContext.close();
  }
});
test("admin translates Chinese-to-English relationships and resets them on pair change", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await openReadingHome(page);
  await createNovel(page, {
    title: zhEnNovelTitle,
    pair: { source: "Chinese (ZH)", target: "English (EN)" },
  });
  await addChapter(page, {
    number: "1",
    title: zhEnChapterTitle,
    source: `儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`,
  });
  await studioSection(page, "Chapters").click();

  await studioSection(page, "Relationships").click();
  await expect(page.getByRole("heading", { name: "Character & Relationships" })).toBeVisible();
  await expect(page.getByText("ZH → EN", { exact: true })).toBeVisible();
  await expect(page.getByText(/Chinese-to-English dialogue/)).toBeVisible();
  await page.getByRole("button", { name: "Add character profile" }).click();
  await expect(page.getByLabel("English name")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await studioSection(page, "Chapters").click();

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
    page.getByText("Cancel active translations before changing the language pair.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(page.url()).toBe(editUrl);

  await studioSection(page, "Chapters").click();
  chapterRow = page.getByRole("row", { name: new RegExp(zhEnChapterTitle) });
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(chapterRow.getByRole("button", { name: "Cancel translation" })).toHaveCount(0, {
    timeout: 90_000,
  });
  await openChapter(page, "Dawn");
  await openReaderAppearance(page);
  await appearanceGroup(page, "View").getByRole("button", { name: "Translation" }).click();
  await closeReaderAppearance(page);
  await expect(
    page.getByText('"I will return," Son said to Father.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(slowTranslationMarker, { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Chapters", exact: true })).toBeVisible();

  await studioSection(page, "Relationships").click();
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

  await studioSection(page, "Relationships").click();
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

  await openReadingHome(page);
  await createNovel(page, {
    title: bulkNovelTitle,
    pair: { source: "Chinese (ZH)", target: "English (EN)" },
  });

  await addChapter(page, {
    number: "1",
    title: "Bulk chapter one",
    source: `儿子对父亲说：“我会回来的。”\n${slowTranslationMarker}`,
  });
  await addChapter(page, {
    number: "2",
    title: "Bulk chapter two",
    source: `父亲点了点头。\n${slowTranslationMarker}`,
  });
  await addChapter(page, { number: "3", title: "Idle chapter", source: "儿子在黎明时回家。" });
  await studioSection(page, "Chapters").click();

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
