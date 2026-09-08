import { expect, test, type Page } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "Chapter Editing Workflow";

async function waitForReactHydration(page: Page) {
  await page.waitForFunction(() => {
    const submit = document.querySelector('button[type="submit"]');
    return submit && Object.keys(submit).some((key) => key.startsWith("__reactProps$"));
  });
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
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();
}

async function addChapter(page: Page, number: string, title: string, content: string) {
  const numberInput = page.getByLabel("Number *");
  await numberInput.fill(number);
  await expect(numberInput).toHaveValue(number);
  await page.getByLabel("Title *").fill(title);
  await page.getByLabel("Raw Content *").fill(content);
  await page.getByRole("button", { name: "Add Chapter", exact: true }).click();
  await expect(page.getByText("Chapter added successfully", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toBeVisible();
}

test("admin reorders and edits every chapter field", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(novelTitle);
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  await addChapter(page, "1", "Source one", "Raw content one.");
  await addChapter(page, "1.5", "Source two", "Raw content two.");
  await addChapter(page, "3", "Source three", "Raw content three.");
  await page.getByRole("link", { name: "Source three", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Source three" })).toBeVisible();
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  await page.getByRole("button", { name: "Reorder chapters" }).click();
  await expect(page.getByRole("heading", { name: "Reorder chapters" })).toBeVisible();
  await expect(page.getByText("Preparing 3 chapters…", { exact: true })).toBeVisible();

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
  await expect(
    page.getByRole("combobox", { name: "Current chapter: Ch. 1 — Source three" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  const firstRow = rows.nth(0);
  await firstRow.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated title for chapter 1").fill("Translated three");
  await firstRow.getByRole("button", { name: "Save translated title" }).click();
  await expect(page.getByText("Translated title updated", { exact: true })).toBeVisible();
  await expect(firstRow.getByRole("link", { name: "Translated three", exact: true })).toBeVisible();
  await firstRow.getByRole("link", { name: "Translated three", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Translated three" })).toBeVisible();
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  await firstRow.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated title for chapter 1").fill("");
  await firstRow.getByRole("button", { name: "Save translated title" }).click();
  await expect(page.getByText("Translated title updated", { exact: true })).toBeVisible();
  await expect(firstRow.getByRole("link", { name: "Source three", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Source two", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Source two" })).toBeVisible();
  await page.getByRole("button", { name: "Edit chapter" }).click();
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

  await page.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Source Title").fill("Unsaved source title");
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByRole("heading", { name: "Discard Unsaved Changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep Editing" }).click();
  await expect(page.getByLabel("Source Title")).toHaveValue("Unsaved source title");
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await page.getByRole("button", { name: "Discard Changes" }).click();

  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();
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

test("admin reviews heuristic findings and rechecks corrected chapters", async ({ page }) => {
  test.setTimeout(180_000);
  const reviewNovelTitle = "Translation Review Workflow";

  await signIn(page);
  await page.getByRole("button", { name: "New Novel" }).click();
  await page.getByLabel("Title *").fill(reviewNovelTitle);
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: reviewNovelTitle })).toBeVisible();

  await addChapter(page, "1", "Alpha arrives", "Alpha arrived.\n\nBeta waited.");
  await addChapter(page, "2", "Beta waits", "Beta waited.");

  const chapterOneRow = page.getByRole("row").filter({ hasText: "Alpha arrives" });
  await chapterOneRow.getByRole("link", { name: "Alpha arrives", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alpha arrives" })).toBeVisible();
  await page.getByRole("button", { name: "Edit chapter" }).click();
  await page.getByLabel("Translated Content").fill("Alpha มาแล้ว");
  await page.getByRole("button", { name: "Save Chapter" }).click();
  await expect(page.getByText("Chapter saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByRole("heading", { name: reviewNovelTitle })).toBeVisible();

  await page.getByRole("button", { name: "Glossary" }).click();
  await expect(page.getByRole("heading", { name: `${reviewNovelTitle} Glossary` })).toBeVisible();
  await page.getByRole("button", { name: "Bulk Import (TSV)" }).click();
  await page.getByLabel("TSV Content").fill("Alpha\tอัลฟา\tother\tReview fixture");
  await page.getByRole("button", { name: "Import Terms" }).click();
  await expect(page.getByText("1–1 of 1 terms")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Back to novel details" }).click();
  await expect(page.getByRole("heading", { name: reviewNovelTitle })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Ch. 1 — Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/Paragraph counts differ/)).toBeVisible();
  await expect(page.getByText(/Approved glossary adherence/)).toBeVisible();

  const firstReportUrl = page.url();
  const firstReportId = new URL(firstReportUrl).searchParams.get("reviewReport");
  expect(firstReportId).toBeTruthy();
  await page.getByRole("combobox", { name: "Show" }).click();
  await page.getByRole("option", { name: "All selected chapters" }).click();
  await expect(page.getByText("Not translated — no quality checks performed")).toBeVisible();

  await captureReview(page, 390, 844, ".tura/e2e/quality-review-mobile.png");
  const reviewUrlForThemes = page.url();
  await captureReview(page, 1280, 900, ".tura/e2e/quality-review-desktop-light.png");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.goto(reviewUrlForThemes);
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ch. 1 — Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await captureReview(page, 1280, 900, ".tura/e2e/quality-review-desktop-dark.png");
  await captureReview(page, 390, 844, ".tura/e2e/quality-review-mobile-dark.png");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.goto(reviewUrlForThemes);
  await expect(page.getByRole("heading", { name: "Quality check" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ch. 1 — Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole("link", { name: "Open chapter" }).first().click();
  await page.getByRole("button", { name: "Edit chapter" }).click();
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
  await expect(page.getByRole("heading", { name: "Ch. 1 — Alpha arrives" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("No heuristic issues found in this check")).toBeVisible();
  await expect(page.getByText("Not translated — no quality checks performed")).toBeVisible();
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
  await page.getByRole("button", { name: "Novel publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(page.getByRole("button", { name: "Novel publishing options" })).toContainText(
    "Live",
  );
  const translatedRow = page.getByRole("row").filter({ hasText: "Alpha arrives" });
  await translatedRow.getByRole("button", { name: "Publishing options" }).click();
  await page.getByRole("menuitem", { name: "Publish now" }).click();
  await expect(translatedRow.getByRole("button", { name: "Publishing options" })).toContainText(
    "Live",
  );

  const publicReviewUrl = correctedReviewUrl;
  await page.getByRole("button", { name: /E2E Admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.goto(publicReviewUrl);
  await expect(page.getByRole("heading", { name: reviewNovelTitle })).toBeVisible();
  await expect(page.getByText("Translation quality", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Quality check" })).toHaveCount(0);
});
