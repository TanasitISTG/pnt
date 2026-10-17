import { expect, test, type Page } from "@playwright/test";

import { claimShared, readShared } from "./fixtures";
import { newGuestContext, openReadingHome, takeSession, waitForHydration } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

const appUrl = readShared("app").url;

const memberEmail = readShared("member-account").email;

/**
 * The two seeded novels this spec reads: the live one, owned by a third account so that nobody is
 * reporting their own novel or working their own case, and the member's own draft. What each of
 * them is for, and what may be done to each, is declared in `e2e/fixtures.ts`.
 */
const reportedNovel = readShared("reported-novel");
const memberNovel = readShared("member-novel");

const reportReason = "Sexual content";
const decisionNote = "E2E: the description promises content the translation does not have.";

/**
 * Sets the language of the signed-in work areas for the next document request.
 *
 * The console is one of them: it carries no locale prefix, so its language comes from the
 * `pnt-locale` cookie - what the switcher writes - and the operator's remembered locale sits
 * behind it. This changes only the cookie, which is what keeps the switch local to this spec.
 */
async function setLocaleCookie(page: Page, origin: string, locale: "en" | "th") {
  await page.context().addCookies([{ name: "pnt-locale", value: locale, url: origin }]);
}

/**
 * The one control the feature adds. Matched exactly, because "Report" is a prefix of the
 * "Reported" state the same button takes after a successful submit.
 */
function reportControl(page: Page) {
  return page.getByRole("button", { name: "Report", exact: true });
}

test("a member reports a published novel and an operator decides the case", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // A reader with no account sees the same novel and is never offered the control:
  // reporting is a signed-in member's act, and the report records who filed it.
  const guestContext = await newGuestContext(browser);
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`${appUrl}/novels/${reportedNovel.id}`);
    await expect(guest.getByRole("heading", { name: reportedNovel.title })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Report", exact: true })).toHaveCount(0);
  } finally {
    await guestContext.close();
  }

  // The reporter gets a browser context of its own: the operator works the same case
  // afterwards, so the two sessions must not share a cookie jar.
  const reporterContext = await browser.newContext({
    storageState: takeSession("member", "read"),
  });
  try {
    const reporter = await reporterContext.newPage();

    // The author of a novel is not offered the report control on it.
    await reporter.goto(`${appUrl}/novels/${memberNovel.id}`);
    await expect(reporter.getByRole("heading", { name: memberNovel.title })).toBeVisible();
    await expect(reporter.getByRole("button", { name: "Report", exact: true })).toHaveCount(0);

    // Someone else's published novel is.
    await reporter.goto(`${appUrl}/novels/${reportedNovel.id}`);
    await expect(reporter.getByRole("heading", { name: reportedNovel.title })).toBeVisible();
    await waitForHydration(reportControl(reporter));
    await reportControl(reporter).click();

    const reportDialog = reporter.getByRole("dialog");
    await expect(reportDialog).toContainText(reportedNovel.title);
    await reportDialog.getByRole("combobox").click();
    await reporter.getByRole("option", { name: reportReason, exact: true }).click();
    // Filing is the one use this novel gives, and `e2e/fixtures.ts` declares it as this spec's:
    // one open report per account per target is a partial unique index, so a second filing in the
    // same run would be refused by the database rather than by the app.
    claimShared("reported-novel", "report", "reports");
    await reportDialog.getByRole("button", { name: "Send report" }).click();

    // The file is durable in the reporter's own view: the control closes its loop as
    // "Reported" instead of inviting a second report of the same novel.
    await expect(reporter.getByRole("button", { name: "Reported", exact: true })).toBeVisible();
    await expect(reporter.getByRole("button", { name: "Reported", exact: true })).toBeDisabled();
    await expect(reportDialog).toHaveCount(0);
  } finally {
    await reporterContext.close();
  }

  // The operator works the queue the member just filled, on the session the fixture holds.
  await openReadingHome(page);
  await page.goto(`${appUrl}/admin/reports`);
  // The tab may carry the open-case count, so it is matched by its leading label.
  await expect(page.getByRole("link", { name: /^Reports/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Reports/ })).toBeVisible();

  const caseRow = page.getByRole("row").filter({ hasText: reportedNovel.title });
  await expect(caseRow).toBeVisible();
  await waitForHydration(caseRow.getByRole("button", { name: /Actions for/ }));

  await caseRow.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Review case" }).click();

  // The case file names the novel, what was said about it, and who said it.
  const caseDialog = page.getByRole("dialog");
  await expect(caseDialog).toContainText(reportedNovel.title);
  await expect(caseDialog).toContainText(memberEmail);
  await expect(caseDialog).toContainText(reportReason);

  await caseDialog.getByLabel("Decision note").fill(decisionNote);
  await caseDialog.getByRole("button", { name: "Dismiss", exact: true }).click();

  await expect(caseDialog).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: reportedNovel.title })).toHaveCount(0);

  // The decision is recorded, not enforced: the case lands in the decided list, and the
  // novel is left exactly as published.
  await page.getByRole("tab", { name: /decided|history/i }).click();
  const decidedRow = page.getByRole("row").filter({ hasText: reportedNovel.title });
  await expect(decidedRow).toBeVisible();
  await expect(decidedRow).toContainText(/dismissed/i);

  // The queue in Thai, at phone width, on both tabs: the case rows, the target filter and the
  // two tab labels are the console's densest copy. `/admin/reports` is a work area, so the
  // language comes from the `pnt-locale` cookie rather than from the URL.
  await page.setViewportSize({ width: 390, height: 844 });
  await setLocaleCookie(page, appUrl, "th");
  await page.goto(`${appUrl}/admin/reports`);
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "รายงาน", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "รอตรวจ" })).toBeVisible();
  await page.getByRole("tab", { name: "ตัดสินแล้ว" }).click();
  await expect(page.getByRole("row").filter({ hasText: reportedNovel.title })).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);

  // Back to English before the last read, which asserts a title rather than a word.
  await setLocaleCookie(page, appUrl, "en");

  await page.goto(`${appUrl}/novels/${reportedNovel.id}`);
  await expect(page.getByRole("heading", { name: reportedNovel.title })).toBeVisible();
});
