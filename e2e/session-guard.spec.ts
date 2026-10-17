import { expect, test } from "@playwright/test";
import { join } from "node:path";

import { readShared } from "./fixtures";
import {
  SESSION_DIR,
  createSessionGuard,
  storedSessions,
  takeSession,
  type StoredSession,
} from "./sessions";

/**
 * The fixture's guard, tested where no session the run needs is at stake.
 *
 * `takeSession` is what stands between a spec and a session the rest of the run reads with, and
 * nothing else exercises its refusals: a suite that is passing never asks for an end it may not
 * have. So the refusals are asserted here instead, and the two ways of doing that are deliberately
 * different. The shared sessions are asked through the run's own guard, because a refused ask
 * spends nothing - which is why the reading that follows each refusal still finds the session. The
 * wrong-end and already-ended cases are asked through an instance built over declarations of this
 * spec's own, because proving those means ending a session, and the one it ends is a file no spec
 * was ever going to use.
 *
 * What is pinned here is mostly the *wording*: it is what the author of the next spec reads when
 * they reach for a session they may not end, and a message that no longer says which session,
 * which account, or why is worse than no message at all.
 *
 * No page is opened - the guard is pure bookkeeping over declarations - so this spec is the one
 * file in the suite that neither reads nor needs the running app.
 */

test("a shared session may not be ended, and a refused ask is not a spend", () => {
  for (const key of ["admin", "member"] as const) {
    for (const use of ["sign-out", "suspension"] as const) {
      expect(() => takeSession(key, use)).toThrow(
        /Nothing in the run may end it: the sessions every signed-in spec shares/,
      );
      // Still there to read with, which is what every signed-in spec after this one needs.
      expect(takeSession(key, "read")).toContain(`${key}.json`);
    }
  }
});

test("the guard refuses an end a declaration does not allow, and a session already ended", () => {
  // Declarations of this spec's own, so the session it ends belongs to no other spec.
  const spendable = join(SESSION_DIR, "guard-spendable.json");
  const guard = createSessionGuard({
    shared: {
      path: join(SESSION_DIR, "guard-shared.json"),
      account: readShared("admin-account"),
      endedBy: null,
    },
    spendable: {
      path: spendable,
      account: readShared("member-account"),
      endedBy: "sign-out",
    },
  } satisfies Record<string, StoredSession>);

  // A declaration is an allowance, not a suggestion: the end it names is the only one allowed.
  expect(guard.take("shared", "read")).toContain("guard-shared.json");
  expect(() => guard.take("shared", "suspension")).toThrow(/Nothing in the run may end it/);
  expect(() => guard.take("spendable", "suspension")).toThrow(
    `The "spendable" session (${readShared("member-account").email}) may not be taken for a ` +
      "suspension. Its declaration allows a sign-out",
  );

  // The end it does allow is handed over once, and then the session is gone for every use.
  expect(guard.take("spendable", "sign-out")).toBe(spendable);
  expect(() => guard.take("spendable", "sign-out")).toThrow(
    `The "spendable" session (${readShared("member-account").email}) has already been ended in ` +
      "this run",
  );
  expect(() => guard.take("spendable", "read")).toThrow(
    "A second spec that has to end a session needs a session of its own",
  );
});

test("every stored session declares what may end it, and the run keeps both kinds", () => {
  const sessions = storedSessions();

  for (const session of sessions) {
    // A path outside the fixture's own directory is one the supervisor does not own, and one a
    // working tree could commit.
    expect(session.path.startsWith(SESSION_DIR)).toBe(true);
    expect(session.account.email).toContain("@");
    expect(session.account.password.length).toBeGreaterThan(0);
  }

  // The two declarations the run depends on: sessions for the specs that only read, and a session
  // for each spec that has to sign one out.
  expect(sessions.filter((session) => session.endedBy === null).length).toBeGreaterThan(0);
  expect(sessions.filter((session) => session.endedBy === "sign-out").length).toBeGreaterThan(0);
});
