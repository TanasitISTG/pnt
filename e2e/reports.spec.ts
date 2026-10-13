import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const memberEmail = "e2e-member@example.test";
const memberPassword = "e2e-member-password-123";

/** Live, and owned by a third account: nobody reports their own novel, or their own case. */
const reportedNovelId = "e2e-reported-novel";
const reportedNovelTitle = "E2E Reported Novel";

/** The member's own unpublished novel, which must never offer the control. */
const memberNovelId = "e2e-member-novel";
const memberNovelTitle = "Member Draft Novel";

const reportReason = "Sexual content";
const decisionNote = "E2E: the description promises content the translation does not have.";

async function waitForReactHydration(page: Page, selector = 'button[type="submit"]') {
  await page.waitForFunction((target) => {
    const node = document.querySelector(target);
    return Boolean(node && Object.keys(node).some((key) => key.startsWith("__reactProps$")));
  }, selector);
}

async function rejectOptionalAnalytics(page: Page) {
  const rejectButton = page.getByRole("button", { name: "Reject optional" });
  if (await rejectButton.isVisible()) await rejectButton.click();
}

/**
 * Fills the sign-in form until the values actually survive in it.
 *
 * Typing into the server-rendered markup before React owns those inputs only writes the
 * DOM: React then paints its own empty state over it, the submit button stays disabled,
 * and the form reports blank required fields without ever sending a request. Waiting for
 * a value to round-trip is what makes that race deterministic instead of occasional.
 */
async function fillCredentials(page: Page, email: string, password: string) {
  await expect(async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toHaveValue(password);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  }).toPass({ timeout: 20_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${appUrl}/login`);
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await fillCredentials(page, email, password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // A signed-in account lands on its reading home; the shelf itself is `/library`.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
}

/**
 * The one control the feature adds. Matched exactly, because "Report" is a prefix of the
 * "Reported" state the same button takes after a successful submit.
 */
function reportControl(page: Page) {
  return page.getByRole("button", { name: "Report", exact: true });
}

/** A document load paints before React attaches handlers, and a click that lands first only focuses. */
async function waitForReportControlHydration(page: Page) {
  await page.waitForFunction(() => {
    const control = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === "Report",
    );
    return Boolean(control && Object.keys(control).some((key) => key.startsWith("__reactProps$")));
  });
}

async function waitForQueueRowHydration(page: Page, title: string) {
  await page.waitForFunction((text) => {
    const row = Array.from(document.querySelectorAll("tr")).find((element) =>
      element.textContent?.includes(text),
    );
    const button = row?.querySelector("button");
    return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps$")));
  }, title);
}

/**
 * Sign-ins are budgeted per client address, and every spec in this suite shares one: the
 * `/sign-in/email` rule allows ten per rolling minute, which the earlier specs spend
 * exactly. This scenario needs two of its own, so it clears that counter in its own
 * disposable database first rather than depending on how the rest of the run was timed.
 * The throttle is unchanged in the application and covered by the rate-limit suites; a
 * real fix is a shared session fixture for every spec, which is a suite-wide change.
 */
test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`DELETE FROM "rate_limit" WHERE "key" LIKE '%sign-in/email%'`;
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("a member reports a published novel and an operator decides the case", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // A reader with no account sees the same novel and is never offered the control:
  // reporting is a signed-in member's act, and the report records who filed it.
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`${appUrl}/novels/${reportedNovelId}`);
    await expect(guest.getByRole("heading", { name: reportedNovelTitle })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Report", exact: true })).toHaveCount(0);
  } finally {
    await guestContext.close();
  }

  // The reporter gets a browser context of its own: the operator works the same case
  // afterwards, so the two sessions must not share a cookie jar.
  const reporterContext = await browser.newContext();
  try {
    const reporter = await reporterContext.newPage();
    await signIn(reporter, memberEmail, memberPassword);

    // The author of a novel is not offered the report control on it.
    await reporter.goto(`${appUrl}/novels/${memberNovelId}`);
    await expect(reporter.getByRole("heading", { name: memberNovelTitle })).toBeVisible();
    await expect(reporter.getByRole("button", { name: "Report", exact: true })).toHaveCount(0);

    // Someone else's published novel is.
    await reporter.goto(`${appUrl}/novels/${reportedNovelId}`);
    await expect(reporter.getByRole("heading", { name: reportedNovelTitle })).toBeVisible();
    await waitForReportControlHydration(reporter);
    await reportControl(reporter).click();

    const reportDialog = reporter.getByRole("dialog");
    await expect(reportDialog).toContainText(reportedNovelTitle);
    await reportDialog.getByRole("combobox").click();
    await reporter.getByRole("option", { name: reportReason, exact: true }).click();
    await reportDialog.getByRole("button", { name: "Send report" }).click();

    // The file is durable in the reporter's own view: the control closes its loop as
    // "Reported" instead of inviting a second report of the same novel.
    await expect(reporter.getByRole("button", { name: "Reported", exact: true })).toBeVisible();
    await expect(reporter.getByRole("button", { name: "Reported", exact: true })).toBeDisabled();
    await expect(reportDialog).toHaveCount(0);
  } finally {
    await reporterContext.close();
  }

  // The operator works the queue the member just filled.
  await signIn(page, adminEmail, adminPassword);
  await page.goto(`${appUrl}/admin/reports`);
  // The tab may carry the open-case count, so it is matched by its leading label.
  await expect(page.getByRole("link", { name: /^Reports/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Reports/ })).toBeVisible();

  const caseRow = page.getByRole("row").filter({ hasText: reportedNovelTitle });
  await expect(caseRow).toBeVisible();
  await waitForQueueRowHydration(page, reportedNovelTitle);

  await caseRow.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Review case" }).click();

  // The case file names the novel, what was said about it, and who said it.
  const caseDialog = page.getByRole("dialog");
  await expect(caseDialog).toContainText(reportedNovelTitle);
  await expect(caseDialog).toContainText(memberEmail);
  await expect(caseDialog).toContainText(reportReason);

  await caseDialog.getByLabel("Decision note").fill(decisionNote);
  await caseDialog.getByRole("button", { name: "Dismiss", exact: true }).click();

  await expect(caseDialog).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: reportedNovelTitle })).toHaveCount(0);

  // The decision is recorded, not enforced: the case lands in the decided list, and the
  // novel is left exactly as published.
  await page.getByRole("tab", { name: /decided|history/i }).click();
  const decidedRow = page.getByRole("row").filter({ hasText: reportedNovelTitle });
  await expect(decidedRow).toBeVisible();
  await expect(decidedRow).toContainText(/dismissed/i);

  await page.goto(`${appUrl}/novels/${reportedNovelId}`);
  await expect(page.getByRole("heading", { name: reportedNovelTitle })).toBeVisible();
});
