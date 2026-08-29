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
