import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const novelTitle = "Reader Upgrade Smoke";
const chapterTitle = "Reader Chapter";
const sourceText = [
  "alpha beta gamma",
  "second paragraph with beta again",
  ...Array.from(
    { length: 45 },
    (_, index) => `filler paragraph ${index + 1} keeps the chapter scrollable`,
  ),
].join("\n");

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

test("reader upgrades: progress, find, bookmarks, typography and page themes", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/login");
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your Library" })).toBeVisible();

  await page.getByRole("button", { name: "New Novel" }).click();
  await waitForReactHydration(page);
  await page.getByLabel("Title *").fill(novelTitle);
  await page.getByRole("button", { name: "Create Novel" }).click();
  await expect(page.getByRole("heading", { name: novelTitle })).toBeVisible();

  await page.getByRole("tab", { name: "Add chapters" }).click();
  await page.getByLabel("Chapter number *").fill("1");
  await page.getByLabel("Chapter title *").fill(chapterTitle);
  await page.getByLabel("Source text *").fill(sourceText);
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();
  await expect(page.getByRole("link", { name: chapterTitle, exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("link", { name: chapterTitle, exact: true }).click();
  await expect(page.getByRole("heading", { name: chapterTitle })).toBeVisible();

  // The toolbar progress hairline tracks the reading position, and reaching the end marks
  // the chapter read. Off-screen paragraphs only have estimated heights, so keep scrolling
  // until the indicator agrees the chapter really is finished.
  const progressBar = page.getByRole("progressbar", { name: "Chapter progress" });
  await expect(progressBar).toBeVisible();
  await expect.poll(async () => Number(await progressBar.getAttribute("aria-valuenow"))).toBe(0);
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
      return Number(await progressBar.getAttribute("aria-valuenow"));
    })
    .toBeGreaterThan(94);
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  // Typography and page theme travel from the settings panel to the rendered prose.
  // The page theme must beat an app dark theme, including the browser color-scheme that
  // next-themes writes inline on <html>.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("radio", { name: "Relaxed · 2.0" }).click();
  await page.getByRole("radio", { name: "Narrow" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Sepia" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute("data-reader-theme", "sepia");
  const sepia = await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  expect(sepia.colorScheme).toBe("light");
  expect(sepia.background).toBe("rgb(244, 236, 216)");
  const prose = page.locator("div[style*='max-width']").filter({ hasText: "alpha beta gamma" });
  await expect(prose).toHaveAttribute("style", /34rem/);
  const lineHeight = await page
    .locator("p", { hasText: "alpha beta gamma" })
    .first()
    .evaluate((element) => getComputedStyle(element).lineHeight);
  expect(Number.parseFloat(lineHeight)).toBeGreaterThan(20);

  // In-chapter find highlights every match and clears when closed.
  await page.keyboard.press("Control+f");
  const findInput = page.getByRole("textbox", { name: "Find in chapter" });
  await expect(findInput).toBeVisible();
  await findInput.fill("beta");
  await expect(page.getByRole("status")).toContainText("1 of 2");
  await expect(page.locator("mark")).toHaveCount(2);
  await page.screenshot({ path: ".tura/e2e/reader-find-bar.png" });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("2 of 2");
  // Escape closes the bar even after focus moved out of the input.
  await page.getByText("filler paragraph 3 keeps the chapter scrollable").click();
  await page.keyboard.press("Escape");
  await expect(findInput).toHaveCount(0);
  await expect(page.locator("mark")).toHaveCount(0);

  // Bookmarks capture the visible paragraph and keep their note.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Bookmark this spot" }).click();
  await expect(page.getByText(/alpha beta gamma/).last()).toBeVisible();
  // Re-bookmarking the same spot reports the existing bookmark instead of adding a twin.
  await page.getByRole("button", { name: "Bookmark this spot" }).click();
  await expect(page.getByText("Already bookmarked here")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Bookmark note").fill("remember beta");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("remember beta")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Reader settings and account bookmarks survive a reload.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-reader-theme", "sepia");
  await expect(page.getByRole("heading", { name: chapterTitle })).toBeVisible();
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await expect(page.getByText("remember beta")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Excerpt recovery: after the source gains a paragraph on top, the bookmark still lands
  // on the bookmarked text rather than the paragraph index it was stored with.
  await page.getByRole("button", { name: "More reader actions" }).click();
  await page.getByRole("menuitem", { name: "Edit chapter" }).click();
  await page.getByLabel("Source Content").fill(`inserted opener\n${sourceText}`);

  // Jumping inside the open chapter is not a reason to warn about unsaved edits.
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Go to" }).click();
  await expect(page.getByRole("heading", { name: "Discard Unsaved Changes?" })).toHaveCount(0);
  await expect(page).toHaveURL(/#reader-paragraph-1$/);

  await page.getByRole("button", { name: "Save Chapter" }).click();
  await expect(page.getByLabel("Source Content")).toHaveCount(0, { timeout: 30_000 });

  // The saved paragraph moved down one, so the stored index no longer matches.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Go to" }).click();
  await expect(page).toHaveURL(/#reader-paragraph-2$/);
  await expect(page.getByText(/alpha beta gamma/).first()).toBeInViewport();

  // Repeating the jump with an unchanged address still moves the reader.
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.getByRole("button", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Go to" }).click();
  await expect(page.getByText(/alpha beta gamma/).first()).toBeInViewport();

  await page.getByRole("button", { name: "Bookmarks" }).click();
  await page.getByRole("button", { name: "Delete bookmark" }).click();
  await expect(page.getByText("remember beta")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  // Back to the app theme, and the novel detail reports reading progress.
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("radio", { name: "Default" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-reader-theme", "sepia");
  // The page theme override is scoped: the app dark theme resumes with its own color-scheme.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    "dark",
  );

  await page.getByRole("button", { name: "Back to chapter list" }).click();
  await expect(page.getByText(/1 of 1 chapters read/)).toBeVisible({ timeout: 15_000 });
});
