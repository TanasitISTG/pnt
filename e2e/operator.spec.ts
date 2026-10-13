import { expect, test, type Page } from "@playwright/test";

const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:3000";

const adminEmail = "e2e-admin@example.test";
const adminPassword = "e2e-password-123";
const memberEmail = "e2e-member@example.test";
const memberPassword = "e2e-member-password-123";
const memberNovelTitle = "Member Draft Novel";
const memberChapterTitle = "Member Draft Chapter";
const suspensionReason = "E2E suspension reason";

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
 * Signs in on a page, under this client address.
 *
 * `/sign-in/email` is rate limited per address and every spec shares one, so this
 * scenario signs in exactly twice: once as the operator, once as the suspended
 * account. The suspended attempt runs in its own browser context so the operator
 * session survives to undo the ban.
 */
async function signIn(page: Page, email: string, password: string, url = "/login") {
  await page.goto(url.startsWith("http") ? url : `${appUrl}${url}`);
  await waitForReactHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in as the operator and opens the Accounts tab, ready for a row menu. */
async function openAccounts(page: Page) {
  await signIn(page, adminEmail, adminPassword);
  // A signed-in account lands on its reading home; the shelf itself is `/library`.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  // A document load renders the table before React attaches its handlers, and a click
  // that lands before that only focuses the button: the menu never opens.
  await waitForReactHydration(page, `button[aria-label="Actions for ${memberEmail}"]`);
}

/** Narrows the account list to the seeded member. */
function memberRow(page: Page) {
  return page.getByRole("row").filter({ hasText: memberEmail });
}

async function openMemberActions(page: Page, label: string) {
  await memberRow(page)
    .getByRole("button", { name: `Actions for ${memberEmail}` })
    .click();
  await page.getByRole("menuitem", { name: label }).click();
}

test("operator moderates, audits, and views an account read-only", async ({ page, browser }) => {
  test.setTimeout(180_000);

  await openAccounts(page);

  // View as the member, for real: the banner stands and a write is refused.
  await openMemberActions(page, "View as this account");
  await page.getByRole("button", { name: "View as this account" }).click();

  await expect(page.getByText(/Viewing as E2E Member, read-only/)).toBeVisible();
  await expect(page.getByText(/Signed in as E2E Admin/)).toBeVisible();
  // Viewing as an account means seeing that account's own home, not the operator's.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  // Reads are the point of a read-only view. The account's own unpublished novel - the
  // resource a guest could never see - opens with its chapters, and the owner-only
  // reads that page fires (metrics, residual scan, reader state) do not surface as a
  // failure. A read that still demanded a writable session would fail this whole step.
  await page.goto("/novels/e2e-member-novel");
  await expect(page.getByRole("heading", { name: memberNovelTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: memberChapterTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  await expect(
    page.getByText("Actions are unavailable while you are viewing as another account."),
  ).toHaveCount(0);

  // Writes stay refused: the same session cannot rename the account.
  await page.goto("/profile");
  await waitForReactHydration(page);
  await page.getByLabel("Display Name").fill("Should Not Persist");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByText("Actions are unavailable while you are viewing as another account."),
  ).toBeVisible();

  // The way back is on every page, and it lands on the operator's own screen.
  await page.getByRole("button", { name: "Return to operator account" }).click();
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByText(/Viewing as/)).toHaveCount(0);

  // Suspend with the reason and the duration the row menu used to throw away.
  await openMemberActions(page, "Suspend account");
  await page.getByLabel("Reason").fill(suspensionReason);
  await page.getByLabel("Suspension duration").click();
  await page.getByRole("option", { name: "7 days" }).click();
  await page.getByRole("button", { name: "Suspend account" }).click();

  // The status column is read from the ban's own expiry, not from the stored flag.
  await expect(page.getByText(/Suspended until/)).toBeVisible();
  await expect(page.getByText(suspensionReason)).toBeVisible();

  // Every operator action landed in the durable trail. Cells are asserted by role:
  // the same words are also in the success toasts, which prove nothing here.
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Operator activity" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Account suspended" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Viewed as account" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Returned to operator" })).toBeVisible();
  await expect(page.getByRole("cell", { name: memberEmail }).first()).toBeVisible();

  // The suspended account is told why, without the wrong-password hint - and it is
  // told in a browser the operator is not signed into.
  const memberContext = await browser.newContext();
  try {
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, memberEmail, memberPassword);
    await expect(memberPage.getByText(/suspended/i)).toBeVisible();
    await expect(memberPage.getByText(/Signed up with Google or Discord/)).toHaveCount(0);
    await expect(memberPage.getByRole("heading", { name: "Welcome back" })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }

  // Still signed in as the operator, so the ban comes off without another sign-in.
  await page.goto("/admin");
  await waitForReactHydration(page, `button[aria-label="Actions for ${memberEmail}"]`);
  await openMemberActions(page, "Restore account");
  await expect(page.getByText(/Suspended until/)).toHaveCount(0);
  await expect(page.getByText(suspensionReason)).toHaveCount(0);
  await expect(memberRow(page).getByText("Verified")).toBeVisible();

  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("cell", { name: "Account restored" })).toBeVisible();
});
