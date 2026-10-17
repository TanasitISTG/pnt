import { expect, test, type Page } from "@playwright/test";

import { claimShared, readShared } from "./fixtures";
import { newGuestContext, takeSession, waitForHydration } from "./sessions";

test.use({ storageState: takeSession("admin", "read") });

// The account this spec moderates and the draft it reads through a read-only view are both
// declared in `e2e/fixtures.ts`, which is also where the seed writes them from.
const appUrl = readShared("app").url;
const admin = readShared("admin-account");
const target = readShared("target-account");
const targetNovel = readShared("target-novel");

const targetEmail = target.email;
const targetPassword = target.password;
const targetNovelTitle = targetNovel.title;
const targetChapterTitle = targetNovel.chapters[0].title;
const suspensionReason = "E2E suspension reason";

async function rejectOptionalAnalytics(page: Page) {
  const rejectButton = page.getByRole("button", { name: "Reject optional" });
  if (await rejectButton.isVisible()) await rejectButton.click();
}

/**
 * Signs in on a page, under this client address.
 *
 * The suite's sessions normally come from the fixture (`e2e/sessions.ts`), and this is the one
 * sign-in that stays in a spec: the account is suspended by the time it is attempted, and being
 * *refused* is the behaviour under test. No stored session could stand in for it - a ban deletes
 * the account's existing sessions - and it runs in a browser context of its own so the operator's
 * session survives to undo the ban.
 */
async function signIn(page: Page, email: string, password: string, url = "/login") {
  await page.goto(url.startsWith("http") ? url : `${appUrl}${url}`);
  await waitForHydration(page);
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Opens the Accounts tab, ready for a row menu.
 *
 * The operator's session comes from the fixture, and the heading is what proves it: a signed-in
 * account without the role is sent home from `/admin`, so this cannot pass while signed out.
 */
async function openAccounts(page: Page) {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  // A document load renders the table before React attaches its handlers, and a click
  // that lands before that only focuses the button: the menu never opens.
  await waitForHydration(
    targetRow(page).getByRole("button", { name: `Actions for ${targetEmail}` }),
  );
}

/** The operator console's own sub-navigation, as opposed to the site header. */
function operatorNav(page: Page) {
  return page.getByRole("navigation", { name: "Operator sections" });
}

/** Narrows the account list to the seeded target. */
function targetRow(page: Page) {
  return page.getByRole("row").filter({ hasText: targetEmail });
}

async function openTargetActions(page: Page, label: string) {
  await targetRow(page)
    .getByRole("button", { name: `Actions for ${targetEmail}` })
    .click();
  await page.getByRole("menuitem", { name: label }).click();
}

test("operator moderates, audits, and views an account read-only", async ({ page, browser }) => {
  test.setTimeout(180_000);

  await openAccounts(page);

  // View as the target, for real: the banner stands and a write is refused.
  await openTargetActions(page, "View as this account");
  await page.getByRole("button", { name: "View as this account" }).click();

  await expect(page.getByText(new RegExp(`Viewing as ${target.name}, read-only`))).toBeVisible();
  await expect(page.getByText(new RegExp(`Signed in as ${admin.name}`))).toBeVisible();
  // Viewing as an account means seeing that account's own home, not the operator's.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  // Reads are the point of a read-only view. The account's own unpublished novel - the
  // resource a guest could never see - opens with its chapters, and the owner-only
  // reads that page fires (metrics, residual scan, reader state) do not surface as a
  // failure. A read that still demanded a writable session would fail this whole step.
  await page.goto(`/novels/${targetNovel.id}`);
  await expect(page.getByRole("heading", { name: targetNovelTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This page did not load" })).toHaveCount(0);
  await expect(
    page.getByText("Actions are unavailable while you are viewing as another account."),
  ).toHaveCount(0);
  // Reading-first: the chapter is still a draft, and a draft collects no reader, so the
  // reading page does not offer it even to its owner. The owner's copy of it is the studio.
  await expect(page.getByRole("link", { name: targetChapterTitle, exact: true })).toHaveCount(0);
  await page.goto(`/novels/${targetNovel.id}/manage/chapters`);
  await expect(page.getByRole("row", { name: new RegExp(targetChapterTitle) })).toBeVisible();

  // Writes stay refused: the same session cannot rename the account.
  await page.goto("/settings/account");
  await waitForHydration(page);
  await page.getByLabel("Display Name").fill("Should Not Persist");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByText("Actions are unavailable while you are viewing as another account."),
  ).toBeVisible();

  // The way back is on every page, and it lands on the operator's own screen.
  await page.getByRole("button", { name: "Return to operator account" }).click();
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByText(/Viewing as/)).toHaveCount(0);

  // Suspending is the one thing the run does to the seeded account, and the declaration gives it
  // to this spec alone: nothing else may take it, and a second claim in one run is refused.
  claimShared("target-account", "suspend", "operator");

  // Suspend with the reason and the duration the row menu used to throw away.
  await openTargetActions(page, "Suspend account");
  await page.getByLabel("Reason").fill(suspensionReason);
  await page.getByLabel("Suspension duration").click();
  await page.getByRole("option", { name: "7 days" }).click();
  await page.getByRole("button", { name: "Suspend account" }).click();

  // The status column is read from the ban's own expiry, not from the stored flag.
  await expect(page.getByText(/Suspended until/)).toBeVisible();
  await expect(page.getByText(suspensionReason)).toBeVisible();

  // Every operator action landed in the durable trail. Cells are asserted by role:
  // the same words are also in the success toasts, which prove nothing here.
  // Scoped to the console's own sub-navigation: the site header also offers an
  // "Activity" link since the jobs console took that name.
  await operatorNav(page).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Operator activity" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Account suspended" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Viewed as account" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Returned to operator" })).toBeVisible();
  await expect(page.getByRole("cell", { name: targetEmail }).first()).toBeVisible();

  // The suspended account is told why, without the wrong-password hint - and it is
  // told in a browser the operator is not signed into.
  const targetContext = await newGuestContext(browser);
  try {
    const targetPage = await targetContext.newPage();
    await signIn(targetPage, targetEmail, targetPassword);
    await expect(targetPage.getByText(/suspended/i)).toBeVisible();
    await expect(targetPage.getByText(/Signed up with Google or Discord/)).toHaveCount(0);
    await expect(targetPage.getByRole("heading", { name: "Welcome back" })).toHaveCount(0);
  } finally {
    await targetContext.close();
  }

  // Still signed in as the operator, so the ban comes off without another sign-in.
  await page.goto("/admin");
  await waitForHydration(
    targetRow(page).getByRole("button", { name: `Actions for ${targetEmail}` }),
  );
  await openTargetActions(page, "Restore account");
  await expect(page.getByText(/Suspended until/)).toHaveCount(0);
  await expect(page.getByText(suspensionReason)).toHaveCount(0);
  await expect(targetRow(page).getByText("Verified")).toBeVisible();

  await operatorNav(page).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("cell", { name: "Account restored" })).toBeVisible();

  // The console in the language the app ships in, at the width where the account list is
  // down to three columns. `/admin` is a work area: it carries no locale prefix, so Thai
  // comes from the `pnt-locale` cookie - what the switcher writes - and the operator's
  // remembered locale, which no spec may change (`e2e/fixtures.ts`), is left alone.
  // This is the only check these Thai labels get in a browser: `บัญชี`, `บทบาท` and `สถานะ`
  // are the headers of the three columns that survive at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .context()
    .addCookies([{ name: "pnt-locale", value: "th", url: new URL(page.url()).origin }]);
  await page.goto("/admin");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { name: "บัญชี" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "บทบาท" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "สถานะ" })).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).resolves.toBe(true);
});
