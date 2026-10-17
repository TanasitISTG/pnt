import { expect, test, type Page } from "@playwright/test";

import { addChapter, createNovel, openChapter, studioSection } from "./novels";
import { openReadingHome, takeSession } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

const novelTitle = "Chapter Editing Workflow";

/**
 * The reader's way out is the novel itself, and the studio is a separate door from there:
 * a chapter link round trip is reader → novel → studio, not one back button.
 */
async function returnToStudio(page: Page, expectedNovelTitle: string) {
  await page.getByRole("button", { name: "Back to novel", exact: true }).click();
  await expect(page.getByRole("heading", { name: expectedNovelTitle })).toBeVisible();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chapters", exact: true })).toBeVisible();
}

/** The app theme is the header's appearance menu, whose trigger names the current state. */
async function chooseAppTheme(page: Page, theme: "Light" | "Dark") {
  await page.getByRole("button", { name: /^Appearance: / }).click();
  await page.getByRole("menuitemradio", { name: theme, exact: true }).click();
}

test("admin reorders and edits every chapter field", async ({ page }) => {
  await openReadingHome(page);
  await createNovel(page, { title: novelTitle });

  await addChapter(page, { number: "1", title: "Source one", source: "Raw content one." });
  await addChapter(page, { number: "1.5", title: "Source two", source: "Raw content two." });
  await addChapter(page, { number: "3", title: "Source three", source: "Raw content three." });
  await openChapter(page, "Source three");
  await returnToStudio(page, novelTitle);

  await page.getByRole("button", { name: "Chapter actions" }).click();
  await page.getByRole("menuitem", { name: "Reorder chapters" }).click();
  await expect(page.getByRole("heading", { name: "Reorder chapters" })).toBeVisible();

  const thirdHandle = page.getByRole("button", {
    name: "Reorder chapter 3: Source three",
  });
  await expect(thirdHandle).toBeVisible();
  await page.waitForTimeout(250);
  await thirdHandle.press("Space");
  await page.waitForTimeout(50);
  await thirdHandle.press("ArrowUp");
  await thirdHandle.press("ArrowUp");
  await expect(page.getByRole("status")).toContainText("moved over");
  await page.waitForTimeout(250);
  await thirdHandle.press("Space");
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page.getByText("Chapter order saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reorder chapters" })).toHaveCount(0);

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Source three");
  await expect(rows.nth(1)).toContainText("Source one");
  await expect(rows.nth(2)).toContainText("Source two");
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText("1");
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText("1.5");
  await expect(rows.nth(2).locator("td").nth(1)).toHaveText("3");

  await rows.nth(0).getByRole("link", { name: "Source three", exact: true }).click();
  // The chapter list is a drawer now: it opens saying which chapter it is on, and marks that
  // chapter as the current page.
  // `exact` matters here: the reader also offers an "All chapters" link back to the novel.
  await page.getByRole("button", { name: "Chapters", exact: true }).click();
  const chapterDrawer = page.getByRole("dialog", { name: "Chapters", exact: true });
  await expect(chapterDrawer.getByText("Reading Ch. 1: Source three")).toBeVisible();
  // A finished chapter's row is named "… Read", so the row is matched on its number and
  // title and judged on the marker that says which one the reader is on.
  await expect(chapterDrawer.getByRole("button", { name: /^1 Source three/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("Escape");
  await expect(chapterDrawer).toBeHidden();

  await returnToStudio(page, novelTitle);

  const firstRow = rows.nth(0);
  await firstRow.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated title for chapter 1").fill("Translated three");
  await firstRow.getByRole("button", { name: "Save translated title" }).click();
  await expect(page.getByText("Translated title updated", { exact: true })).toBeVisible();
  await expect(firstRow.getByRole("link", { name: "Translated three", exact: true })).toBeVisible();
  await firstRow.getByRole("link", { name: "Translated three", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Translated three" })).toBeVisible();
  await returnToStudio(page, novelTitle);

  await firstRow.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated title for chapter 1").fill("");
  await firstRow.getByRole("button", { name: "Save translated title" }).click();
  await expect(page.getByText("Translated title updated", { exact: true })).toBeVisible();
  await expect(firstRow.getByRole("link", { name: "Source three", exact: true })).toBeVisible();

  await openChapter(page, "Source two");
  await page.getByRole("button", { name: "More reader actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chapter" }).click();
  await expect(page.getByLabel("Source Title")).toHaveValue("Source two");
  await expect(page.getByLabel("Translated Title")).toHaveValue("");
  await page.getByLabel("Source Title").fill("   ");
  await page.keyboard.press("Control+S");
  await expect(page.getByLabel("Source Title")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Source title is required", { exact: true })).toBeVisible();

  await page.getByLabel("Source Title").fill("Edited source two");
  await page.getByLabel("Translated Title").fill("Translated two");
  await page.getByLabel("Source Content").fill("Edited raw two.");
  await page.getByLabel("Translated Content").fill("Translated body two.");
  await page.getByRole("button", { name: "Save Chapter" }).click();

  await expect(page.getByRole("heading", { name: "Source Changed" })).toBeVisible();
  await expect(
    page.getByText(
      "Keeping the translation marks it as manually edited. Clearing removes the translated title and content so the chapter can be retranslated.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep Translation" }).click();
  await expect(page.getByText("Chapter saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Translated two" })).toBeVisible();
  await expect(page.getByText("Edited source two", { exact: true })).toBeVisible();
  await expect(page.getByText("Translated body two.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More reader actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chapter" }).click();
  await page.getByLabel("Source Title").fill("Unsaved source title");
  await page.getByRole("button", { name: "Back to novel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discard Unsaved Changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing" }).click();
  await expect(page.getByLabel("Source Title")).toHaveValue("Unsaved source title");
  await page.getByRole("button", { name: "Back to novel", exact: true }).click();
  await page.getByRole("button", { name: "Discard Changes" }).click();

  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const savedRow = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: "Translated two", exact: true }) });
  await expect(savedRow).toBeVisible();
  await savedRow.getByRole("link", { name: "Translated two", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Translated two" })).toBeVisible();
  await expect(page.getByText("Edited source two", { exact: true })).toBeVisible();
  await expect(page.getByText("Translated body two.", { exact: true })).toBeVisible();
});

async function captureReview(page: Page, width: number, height: number, path: string) {
  await page.setViewportSize({ width, height });
  const dialog = page.getByRole("dialog", { name: "Quality check" });
  await expect
    .poll(async () => {
      const rect = await dialog.boundingBox();
      return (
        !!rect &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= height + 1 &&
        Math.abs(rect.width - Math.min(1024, width - 16)) <= 1
      );
    })
    .toBe(true);
  await expect(dialog.getByRole("combobox", { name: "Show" })).toContainText(
    "All selected chapters",
  );
  const undersized = await dialog.locator("button, a").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      })
      .map((element) => element.getAttribute("aria-label") || element.textContent),
  );
  expect(undersized).toEqual([]);
  await page.screenshot({ path });
}

test("admin reviews heuristic findings and rechecks corrected chapters", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const reviewNovelTitle = "Translation Review Workflow";

  await openReadingHome(page);
  const reviewNovelId = await createNovel(page, { title: reviewNovelTitle });

  await addChapter(page, {
    number: "1",
    title: "Alpha arrives",
    source: "Alpha arrived.\n\nBeta waited.",
  });
  await addChapter(page, { number: "2", title: "Beta waits", source: "Beta waited." });
  await openChapter(page, "Alpha arrives");
  await page.getByRole("button", { name: "More reader actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated Content").fill("Alpha มาแล้ว");
  await page.getByRole("button", { name: "Save Chapter" }).click();
  await expect(page.getByText("Chapter saved", { exact: true })).toBeVisible();
  await returnToStudio(page, reviewNovelTitle);
  await studioSection(page, "Glossary").click();
  await expect(page.getByRole("heading", { name: `${reviewNovelTitle} Glossary` })).toBeVisible();
  await page.getByRole("button", { name: "Bulk Import (TSV)" }).click();
  await page.getByLabel("TSV Content").fill("Alpha\tอัลฟา\tother\tReview fixture");
  await page.getByRole("button", { name: "Import Terms" }).click();
  await expect(page.getByText("1–1 of 1 terms")).toBeVisible({ timeout: 15_000 });
  await studioSection(page, "Quality").click();

  const selector = page.getByLabel("Chapters to check");
  await selector.fill("1,,2");
  await selector.press("Enter");
  await expect(selector).toHaveAttribute("aria-invalid", "true");
  await expect(selector).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Quality check" })).toHaveCount(0);
  await selector.fill("all");
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText("Quality check queued", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ch. 1: Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/Paragraph counts differ/)).toBeVisible();
  await expect(page.getByText(/Approved glossary adherence/)).toBeVisible();

  const firstReportUrl = page.url();
  const firstReportId = new URL(firstReportUrl).searchParams.get("reviewReport");
  expect(firstReportId).toBeTruthy();
  await page.getByRole("combobox", { name: "Show" }).click();
  await page.getByRole("option", { name: "All selected chapters" }).click();
  await expect(page.getByText("Not translated: no quality checks performed")).toBeVisible();

  await captureReview(page, 390, 844, ".tura/e2e/quality-review-mobile.png");
  const reviewUrlForThemes = page.url();
  await captureReview(page, 1280, 900, ".tura/e2e/quality-review-desktop-light.png");
  await page.keyboard.press("Escape");
  await chooseAppTheme(page, "Dark");
  await page.goto(reviewUrlForThemes);
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ch. 1: Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await captureReview(page, 1280, 900, ".tura/e2e/quality-review-desktop-dark.png");
  await captureReview(page, 390, 844, ".tura/e2e/quality-review-mobile-dark.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Escape");
  await chooseAppTheme(page, "Light");
  await page.goto(reviewUrlForThemes);
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ch. 1: Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole("link", { name: "Open chapter" }).first().click();
  await page.getByRole("button", { name: "More reader actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated Content").fill("อัลฟามาถึง\n\nเบต้ารออยู่");
  await page.getByRole("button", { name: "Save Chapter" }).click();
  await expect(page.getByText("Chapter saved", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByText("Changed since check")).toBeVisible();
  expect(page.url()).toContain(`reviewReport=${firstReportId}`);

  await page.getByRole("button", { name: "Run again" }).click();
  await expect(page.getByText("Quality check queued", { exact: true })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("reviewReport"), { timeout: 15_000 })
    .not.toBe(firstReportId);
  await page.getByRole("combobox", { name: "Show" }).click();
  await page.getByRole("option", { name: "All selected chapters" }).click();
  await expect(page.getByRole("heading", { name: "Ch. 1: Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("No heuristic issues found in this check")).toBeVisible();
  await expect(page.getByText("Not translated: no quality checks performed")).toBeVisible();
  await captureReview(page, 1280, 900, ".tura/e2e/quality-review-corrected.png");
  const correctedReviewUrl = page.url();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  expect(page.url()).toBe(correctedReviewUrl);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Quality check" })).toHaveCount(0);
  const viewFindings = page.getByRole("button", { name: "View findings" }).first();
  await viewFindings.click();
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(viewFindings).toBeFocused();
  await studioSection(page, "Chapters").click();
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
  const translatedRow = page.getByRole("row").filter({ hasText: "Alpha arrives" });
  await translatedRow.getByRole("button", { name: "Publishing options" }).click();
  await page
    .getByRole("menu", { name: "Publishing options", exact: true })
    .getByRole("menuitem", { name: "Publish now" })
    .click();
  await expect(translatedRow.getByRole("button", { name: "Publishing options" })).toContainText(
    "Live",
  );

  // The rest of this test is the guest's view, which needs a signed-out browser - and signing out
  // ends the session it is given. This is the run's second test, so it cannot be the shared one:
  // every spec after this file still has to be signed in. So it signs out on a session declared
  // as this spec's to end (`SESSIONS` in `e2e/sessions.ts`), and the shared one is left alone.
  const guestContext = await browser.newContext({
    storageState: takeSession("chapter-editing", "sign-out"),
  });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await expect(guest.getByRole("heading", { name: "Welcome back" })).toBeVisible();

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

    // The reading page is public and carries none of the studio's quality affordances.
    await guest.goto(`/novels/${reviewNovelId}`);
    await expect(guest.getByRole("heading", { name: reviewNovelTitle })).toBeVisible();
    await expect(guest.getByText("Translation quality", { exact: true })).toHaveCount(0);
    await expect(guest.getByRole("heading", { name: "Quality check" })).toHaveCount(0);

    // The studio section the review link points at is the owner's, so a guest is sent to sign in.
    await guest.goto(correctedReviewUrl);
    await expect(guest.getByRole("button", { name: "Sign in" })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
