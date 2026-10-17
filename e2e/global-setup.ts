import { chromium, type Browser, type FullConfig, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

import {
  SESSION_DIR,
  storedSessions,
  waitForHydration,
  type Account,
  type StoredSession,
} from "./sessions";
import { declaredClaims } from "./fixtures";

/** How long a saved session is given to open the account screen it has to be able to open. */
const SESSION_CHECK_TIMEOUT = 15_000;

/**
 * Signs each account in once, through the form, and saves the session for the specs to reuse.
 *
 * Signing in through the page rather than through the API keeps the fixture honest: what gets
 * saved is the cookie the app really issues, and the sign-in form is still exercised on every run
 * - four times instead of ten, which is what leaves the rate limit alone. (The operator spec
 * still signs in once more, deliberately, to watch the app refuse a suspended account.)
 *
 * Every session is then proved to be one the app still accepts, before a single spec runs: see
 * `assertSavedSession`. The states are written before any test starts, so a spec that signs out
 * cannot affect a spec that has not run yet - the two specs that sign out do it on a session of
 * their own, declared as theirs in `SESSIONS` (`e2e/sessions.ts`), and so cannot touch the shared
 * one either.
 *
 * The receipt goes on to print what the run shares beyond sessions: every fixture claim `SHARED`
 * (`e2e/fixtures.ts`) declares, which is what a spec is allowed to do to the seeded rows and to
 * the windows of the app's own metering, and whether that claim is put back afterwards or spent for
 * good - the half of the receipt `global-teardown.ts` then holds the run to. A run whose log says
 * who spends which window is a run whose log can be read when the failure is in the middle of it.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? process.env.E2E_APP_URL;
  const channel = config.projects[0]?.use.channel ?? process.env.PLAYWRIGHT_CHANNEL ?? "chrome";

  await mkdir(SESSION_DIR, { recursive: true });
  const browser = await chromium.launch({ channel, headless: true });
  try {
    for (const session of storedSessions()) {
      await saveSession(browser, baseURL, session);
      await assertSavedSession(browser, baseURL, session);
      // The declaration goes in the receipt, so the log of a run says what each session is for.
      const declaration =
        session.endedBy === null ? "nothing may end it" : `ended by a ${session.endedBy}`;
      console.log(
        `Saved and verified the session for ${session.account.email} ` +
          `(${basename(session.path)}, ${declaration})`,
      );
    }

    for (const claim of declaredClaims()) {
      // A claim that is handed back says so, because it is the half of the run the teardown checks.
      const handedBack = claim.putBack ? ", put back afterwards" : ", one-way";
      console.log(`Shared fixture "${claim.fixture}": ${claim.use} is ${claim.by}'s${handedBack}`);
    }
  } finally {
    await browser.close();
  }
}

/** Signs an account in on the page a reader would use, and writes what the specs will reuse. */
async function saveSession(
  browser: Browser,
  baseURL: string | undefined,
  session: StoredSession,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    await signIn(await context.newPage(), session.account);
    await context.storageState({ path: session.path });
  } finally {
    await context.close();
  }
}

/**
 * Proves the file that was just written holds a session the app still accepts.
 *
 * A `storageState` taken from a live context says nothing about the file it is written to: a
 * cookie that has expired, one whose domain or path the reopened context never sends, a copy of
 * another account's jar, or a session row the database has dropped all leave a plausible looking
 * file behind. The failure then lands in the middle of whichever spec reads that session, as
 * whatever that spec happened to be asserting at the time, and reads like a product bug - while a
 * session that is already dead when the run starts is a fixture problem.
 *
 * So each file is reopened in a context of its own and asked for the account it is named after.
 * The account screen is behind `_protected` and prints the signed-in address straight out of the
 * session, so a dead session cannot reach it and a session belonging to someone else cannot pass
 * it. What this cannot do is keep a session alive: signing out and suspending an account each
 * delete the sessions they reach, which is why the specs that do those things take a session of
 * their own rather than the shared one.
 */
async function assertSavedSession(
  browser: Browser,
  baseURL: string | undefined,
  session: StoredSession,
): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: session.path });
  try {
    const page = await context.newPage();
    await page.goto("/settings/account");
    const served = await readSignedInAddress(page);
    if (served !== session.account.email) {
      throw unverifiedSession(session, served);
    }
  } finally {
    await context.close();
  }
}

/** The address the account screen printed, or `null` when it printed none - which a guest gets. */
async function readSignedInAddress(page: Page): Promise<string | null> {
  try {
    return await page
      .getByLabel("Email", { exact: true })
      .inputValue({ timeout: SESSION_CHECK_TIMEOUT });
  } catch {
    // Carried into `unverifiedSession`, which is the only error a caller ever sees.
    return null;
  }
}

/** A session file that does not open the account it is named after, as the setup failure. */
function unverifiedSession(session: StoredSession, served: string | null): Error {
  const read =
    served === null || served === ""
      ? "its account screen printed no address"
      : `its account screen printed ${served}`;
  return new Error(
    `The saved session for ${session.account.email} is not a live session for that account: ` +
      `${read} (${session.path}). A session expires, and signing out or suspending the account ` +
      "deletes one, so a file left over from an earlier run cannot be reused - run the suite " +
      "through `bun run test:e2e`, which signs every account in again and rewrites every session.",
  );
}

/** The form's own path to a session, on the page a reader would use. */
async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await waitForHydration(page);

  // Declining here also records the choice in the session's cookie jar, so the specs that use
  // these sessions never see the consent banner and never load an analytics script.
  const reject = page.getByRole("button", { name: "Reject optional" });
  if (await reject.isVisible()) await reject.click();

  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Waiting for the reading home is what proves a session exists before it is written out.
  await page.getByRole("heading", { name: "Welcome back" }).waitFor({ timeout: 30_000 });
}
