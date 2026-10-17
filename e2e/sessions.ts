import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readShared, type SeededAccount } from "./fixtures";

/**
 * The suite's sessions, and what may end them.
 *
 * The accounts themselves are declared in `fixtures.ts`, next to what each one is for and what a
 * spec may do to it, because the seed script writes them from the same declarations. What is left
 * here is the signed-in state: which account each file holds, and what the run may do that would
 * end it.
 *
 * Playwright hands every test a browser context of its own, so a spec that needed a signed-in
 * reader used to sign in through the form - and the suite did that ten times, spread across the
 * run, which is exactly the `/sign-in/email` budget (ten per rolling minute per address). The
 * last spec in the run cleared the rate-limit table to buy back the two it needed.
 *
 * `global-setup.ts` signs each account in once instead, writes the session to a file here, and
 * verifies it before the run starts. A spec opts in with `takeSession("admin", "read")` and never
 * touches the form; what it may do with the session it takes is declared in `SESSIONS` below.
 * Nothing changes for a spec that wants a guest: the default is still no session at all, which is
 * what the locale and guest-rate-limit specs rely on, and what `newGuestContext` restores to a
 * signed-in spec.
 *
 * The files are written under the ignored scratch directory the supervisor owns, so a session
 * cannot be committed, and they are rewritten on every run: a session saved yesterday is a session
 * the database may have dropped.
 */

/**
 * An account a stored session can hold.
 *
 * A session needs an address and a password and nothing else, which is two fields of what
 * `fixtures.ts` declares about a seeded account. Signing one in is the only place an account's
 * password is read outside the seed that hashes it.
 */
export type Account = Pick<SeededAccount, "email" | "password">;

/** Where the saved sessions live, resolved from this file rather than from the process's cwd. */
export const SESSION_DIR = join(
  fileURLToPath(new URL("..", import.meta.url)),
  ".tura",
  "e2e",
  "sessions",
);

/**
 * What ends a stored session while the run is under way.
 *
 * A `sign-out` deletes the one session the browser was handed. A `suspension` deletes every session
 * the account holds - the admin plugin's `banUser` calls `deleteUserSessions` - which is why the
 * account a spec suspends (`target-account`) has no stored session to lose.
 */
export type SessionEnd = "sign-out" | "suspension";

/**
 * What a spec declares it is about to do with the session it asks for.
 *
 * `read` is a spec using the session; either end is the spec ending it, and `takeSession` refuses
 * a use the session's own declaration does not allow.
 */
export type SessionUse = "read" | SessionEnd;

/** A session the fixture saves, and what the run may do that would end it. */
export interface StoredSession {
  /** The file, under the ignored scratch directory the supervisor owns. */
  path: string;
  /** The account it holds, so a spec is never handed another account's cookie jar by accident. */
  account: Account;
  /** What may end it; `null` when nothing in the run may - a session specs only read with. */
  endedBy: SessionEnd | null;
}

/**
 * Every session the fixture saves, keyed by what may end it.
 *
 * The declaration is the point of the table. A session that nothing ends is handed to every
 * signed-in spec, so nothing may end it: `chapter-editing.spec.ts` is the run's first file, and
 * when it signed out of the shared session every spec after it read as a guest. A session a spec
 * *is* allowed to end belongs to that spec alone - named for it, ended once - because a sign-out
 * deletes exactly the session it was handed, and a suspension takes every session the account
 * holds.
 *
 * The suite runs one worker, which is what `playwright.config.ts` pins: these are files, and two
 * workers ending or sharing one would each get half a run.
 */
const SESSIONS = {
  /** The operator's own: every signed-in spec reads with it, and none of them ends it. */
  admin: {
    path: join(SESSION_DIR, "admin.json"),
    account: readShared("admin-account"),
    endedBy: null,
  },
  /** The member's: `reports.spec.ts` files a report with it, and nothing ends it. */
  member: {
    path: join(SESSION_DIR, "member.json"),
    account: readShared("member-account"),
    endedBy: null,
  },
  /** `chapter-editing.spec.ts` signs this one out: the run's second test ends as a guest. */
  "chapter-editing": {
    path: join(SESSION_DIR, "admin-chapter-editing.json"),
    account: readShared("admin-account"),
    endedBy: "sign-out",
  },
  /** `publish-translation.spec.ts` signs this one out, for the guest read its first test ends on. */
  "publish-translation": {
    path: join(SESSION_DIR, "admin-publish-translation.json"),
    account: readShared("admin-account"),
    endedBy: "sign-out",
  },
} satisfies Record<string, StoredSession>;

/** The names a session can be asked for under. */
export type SessionKey = keyof typeof SESSIONS;

/** Every session the fixture writes, for `global-setup.ts` to sign in, save and verify. */
export function storedSessions(): readonly StoredSession[] {
  return Object.values(SESSIONS);
}

/**
 * A declaration table, and the sessions it has already handed over for ending, as one lookup.
 *
 * `take` is the only way a spec gets a session path, which is what makes a declaration binding
 * rather than documentary: a spec that asks to end a session gets what that session declares, or
 * an error naming the session, the account and what may end it. It cannot see *who* is asking, so
 * the rule is the one the declaration states - a session a spec may end is one no other spec may
 * end afterwards - and a second ask is refused rather than handed a file that no longer holds a
 * session.
 *
 * The guard is built rather than fixed at module scope so that its refusals can be proved without
 * putting a session the run needs at risk. `session-guard.spec.ts` builds an instance over
 * declarations of its own, ends a session no spec was ever going to use, and leaves the run's own
 * instance - the one every spec shares - untouched.
 */
export interface SessionGuard<Key extends string> {
  /** The path of the session `key` names, for the use declared; throws when it may not be taken. */
  take(key: Key, use: SessionUse): string;
}

/** Builds a guard over `declarations`, with its own record of what has been ended. */
export function createSessionGuard<const Declarations extends Record<string, StoredSession>>(
  declarations: Declarations,
): SessionGuard<keyof Declarations & string> {
  const ended = new Set<keyof Declarations & string>();
  return {
    take(key, use) {
      const session = declarations[key];
      assertSessionIsStillAlive(ended, key, session);
      if (use !== "read") {
        assertSessionMayBeEnded(key, session, use);
        ended.add(key);
      }
      return session.path;
    },
  };
}

/** The run's own guard, over the declarations above. */
const guard = createSessionGuard(SESSIONS);

/**
 * Hands a spec the session it asks for, for the use it declares.
 *
 * Every session a spec runs with comes through here. A refused ask is not a spend - the guard
 * throws before it records anything - so a spec that asks for an end it may not have, or that only
 * reads, leaves the session for every spec after it.
 */
export function takeSession(key: SessionKey, use: SessionUse): string {
  return guard.take(key, use);
}

/** Refuses a session that this guard has already handed over for ending. */
function assertSessionIsStillAlive(
  ended: ReadonlySet<string>,
  key: string,
  session: StoredSession,
): void {
  if (!ended.has(key)) return;
  throw new Error(
    `The "${key}" session (${session.account.email}) has already been ended in this run, so its ` +
      "file no longer holds one. A second spec that has to end a session needs a session of its own: " +
      "declare it in `SESSIONS` (`e2e/sessions.ts`).",
  );
}

/** Refuses an end the session's own declaration does not allow. */
function assertSessionMayBeEnded(key: string, session: StoredSession, use: SessionEnd): void {
  if (session.endedBy === use) return;
  const declaration =
    session.endedBy === null
      ? "Nothing in the run may end it: the sessions every signed-in spec shares are what the rest " +
        "of the run reads with, and a spec that ends one hands every spec after it a dead cookie."
      : `Its declaration allows ${describeEnd(session.endedBy)}, which is how the spec it belongs to ends it.`;
  throw new Error(
    `The "${key}" session (${session.account.email}) may not be taken for ${describeEnd(use)}. ${declaration}`,
  );
}

/** How a `SessionEnd` reads in a sentence. */
function describeEnd(end: SessionEnd): string {
  return end === "sign-out" ? "a sign-out" : "a suspension";
}

/**
 * A context with no session at all, for the specs that need one.
 *
 * A signed-in spec cannot get a guest by calling `browser.newContext()`: Playwright copies the
 * spec's own context options into every context the test creates (`runBeforeCreateBrowserContext`
 * in the test runner), so the "guest" inherits the operator's session - which is how the reporting
 * spec's guest came to be looking at a member's own Report control. An explicit empty state is
 * what overrides the inherited one; `baseURL` and the rest of the options still come along.
 */
export async function newGuestContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/** React marks every element it owns with a `__reactProps$…` key, and only once it has hydrated. */
const REACT_PROPS_PREFIX = "__reactProps$";

/** What a spec that drives a form waits on: the button that submits the form on screen. */
const FORM_SUBMIT_SELECTOR = 'button[type="submit"]';

/** The budget both shapes below give themselves, which is what `page.waitForFunction` would take. */
const HYDRATION_TIMEOUT = 30_000;

/**
 * Waits until React has attached its handlers, so that the interaction that follows is heard.
 *
 * A server-rendered page paints and looks actionable before hydration, and a click that lands in
 * that window only focuses the control: the menu it was meant to open never opens, the field the
 * spec typed into submits its first value, and the spec fails looking like a product bug.
 *
 * Two shapes, because the suite reaches for both. Given a `Locator`, it waits for that exact
 * control - the one the spec is about to click, however it was found - and an element that is not
 * in the document yet simply is not hydrated yet. Given a `Page` and a CSS selector, it waits for
 * the first node the selector finds; with no selector that is the form's own submit button, which
 * is what every spec that signs a form in or fills one out needs.
 */
export function waitForHydration(locator: Locator): Promise<void>;
export function waitForHydration(page: Page, selector?: string): Promise<void>;
export async function waitForHydration(
  target: Page | Locator,
  selector = FORM_SUBMIT_SELECTOR,
): Promise<void> {
  if (isLocator(target)) {
    await expect
      .poll(
        () =>
          target.evaluateAll(
            (elements, prefix) =>
              elements.some((element) =>
                Object.keys(element).some((key) => key.startsWith(prefix)),
              ),
            REACT_PROPS_PREFIX,
          ),
        {
          message: "the control must be hydrated before it can be used",
          timeout: HYDRATION_TIMEOUT,
        },
      )
      .toBe(true);
    return;
  }

  await target.waitForFunction(
    ({ cssSelector, prefix }) => {
      const node = document.querySelector(cssSelector);
      return Boolean(node && Object.keys(node).some((key) => key.startsWith(prefix)));
    },
    { cssSelector: selector, prefix: REACT_PROPS_PREFIX },
    { timeout: HYDRATION_TIMEOUT },
  );
}

/**
 * Playwright exports `Locator` as a type rather than a class, so the two shapes above are told
 * apart by the method a locator owns and a page does not.
 */
function isLocator(target: Page | Locator): target is Locator {
  return typeof (target as Locator).evaluateAll === "function";
}

/**
 * Opens the reading home a stored session lands on, and waits for it to be interactive.
 *
 * Every spec that no longer signs in through the form starts here instead. The heading proves the
 * fixture's session is still live, rather than leaving a signed-out context to fail somewhere
 * later in a way that reads like a product bug; the shell's own controls are what say the page can
 * be used, so a spec's first click lands on a handler rather than on a rendered button.
 */
export async function openReadingHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await waitForHydration(page, "header button");
}
