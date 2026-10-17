import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  accountsToPutBack,
  assertFixturesPutBack,
  claimShared,
  createSharedGuard,
  declaredClaims,
  declaredWindows,
  readShared,
  seededAccounts,
  seededNovels,
  SHARED,
  type SharedFixture,
  type StoredAccount,
} from "./fixtures";
import { storedSessions } from "./sessions";

/**
 * The guard over what the run shares, tested where no claim it needs is at stake.
 *
 * `claimShared` is what stands between a spec and a fixture the rest of the run depends on, and
 * nothing else exercises its refusals: a suite that is passing never asks for a use it may not
 * have. So they are asserted here instead, and the two ways of doing that are deliberately
 * different. The refusals are asked through an instance built over declarations of this spec's own,
 * because proving the second claim needs one to be spent, and the one spent here is a fixture no
 * spec was ever going to use. The declarations themselves are then held against the run they
 * describe: an owner that is not a declared account, a claim naming a spec file that has been
 * renamed, or two rows sharing an id are all things a table like this drifts into.
 *
 * Nothing here claims a fixture of the run's own. This file is reached before the specs whose
 * claims it would spend - the guest window and the upload window both belong to specs that run
 * after it - so a claim on the real table here would be a claim taken away from them.
 *
 * The second half of the same job is the read-back: what a claim lets a spec change is one thing,
 * and whether the fixture came back is another. `assertFixturesPutBack` is proved here too, over
 * rows this spec writes rather than over the run's database, so the failure it produces for a
 * forgotten restore is a test rather than a discovery.
 *
 * No page is opened: the guard is bookkeeping over declarations, and this is the second of the two
 * files in the suite that need no running app.
 */

const e2eDir = fileURLToPath(new URL(".", import.meta.url));

/** The rows with one account replaced, as a run that changed it and did not put it back leaves it. */
function withAccount(
  rows: readonly StoredAccount[],
  id: string,
  stored: Partial<StoredAccount>,
): readonly StoredAccount[] {
  return rows.map((row) => (row.id === id ? { ...row, ...stored } : row));
}

test("the guard refuses a use nothing declares, another spec's use, and a second claim", () => {
  const guard = createSharedGuard({
    seeded: {
      kind: "novel",
      id: "guard-novel",
      title: "Guard Novel",
      owner: "member-account",
      published: false,
      chapters: [],
      uses: {},
      because: "Nothing in the run may do anything with this but read it.",
    },
    window: {
      kind: "window",
      bucket: "guard",
      subject: "203.0.113.9",
      limit: 2,
      uses: { spend: { by: "reports" } },
      because: "One spec spends this, and the point of the declaration is that it is spent once.",
    },
  } satisfies Record<string, SharedFixture>);

  // Reading is never refused, and needs nothing declared: it changes nothing and spends nothing.
  expect(guard.read("seeded").title).toBe("Guard Novel");
  expect(guard.read("window").limit).toBe(2);

  // A use the fixture does not declare, and a use it declares under another name.
  expect(() => guard.claim("seeded", "spend", "reports")).toThrow(
    'The "seeded" fixture may not be taken for spend: no spec may take it for anything but ' +
      "reading. Nothing in the run may do anything with this but read it.",
  );
  expect(() => guard.claim("window", "change", "reports")).toThrow(
    "the use it declares is spend, not change",
  );

  // A use the declaration gives to another spec - refused, and refusing spends nothing.
  expect(() => guard.claim("window", "spend", "operator")).toThrow(
    'The "window" fixture may not be taken for spend by operator: the declaration gives that use ' +
      "to reports.",
  );

  // The claim it does give, handed over once and then gone for every use.
  expect(guard.claim("window", "spend", "reports").limit).toBe(2);
  expect(() => guard.claim("window", "spend", "reports")).toThrow(
    'The "window" fixture has already been taken for spend in this run',
  );
});

test("the run's own guard refuses what nothing may change, and hands over the rest", () => {
  // The seeded rows exist to be asserted against, so a spec reaching to change one is refused here
  // rather than breaking a spec that runs later.
  expect(() => claimShared("member-novel", "publish", "reports")).toThrow(
    /no spec may take it for anything but reading/,
  );
  expect(() => claimShared("reported-novel", "report", "operator")).toThrow(
    /the declaration gives that use to reports/,
  );

  // What the run does allow: reading the seeded rows, which is what the specs that name them do.
  expect(readShared("member-novel").title).toBe("Member Draft Novel");
  expect(readShared("reported-novel").chapters[0].id).toBe("e2e-reported-chapter");
});

test("the run reads the accounts back, and names the spec that did not put one back", () => {
  // The rows as the seed writes them, which is what a run that put everything back leaves behind.
  const seeded: readonly StoredAccount[] = seededAccounts().map((account) => ({
    id: account.id,
    name: account.name,
    image: null,
    suspended: false,
  }));
  expect(() => assertFixturesPutBack(seeded)).not.toThrow();

  // The operator left renamed and photographed. The finding names the spec, because the declaration
  // is what says who puts the fixture back, and quotes what that declaration promised to put back.
  expect(() =>
    assertFixturesPutBack(
      withAccount(seeded, "e2e-admin", { name: "E2E Curator", image: "avatars/abc.webp" }),
    ),
  ).toThrow(
    '- The "admin-account" fixture was not put back by profile: the display name is "E2E Curator" ' +
      'where the seed writes "E2E Admin", it carries a stored photo. The declaration has profile ' +
      "putting the fixture back after change: the seeded display name and no stored photo.",
  );

  // A suspension the run never lifts, and an account no claim gives any spec a use of.
  expect(() =>
    assertFixturesPutBack(withAccount(seeded, "e2e-target", { suspended: true })),
  ).toThrow(/The "target-account" fixture was not put back by operator: it is suspended/);
  expect(() =>
    assertFixturesPutBack(withAccount(seeded, "e2e-member", { name: "Someone Else" })),
  ).toThrow(
    /The "member-account" fixture is not as the seed wrote it: the display name is "Someone Else" where the seed writes "E2E Member". Nothing in the run gives any spec a use of it beyond reading/,
  );

  // A row the run deleted is the same finding, and a run that broke two fixtures names both rather
  // than the first: the log of a bad run should be the whole of what it has to say.
  const withoutAuthor = seeded.filter((row) => row.id !== "e2e-author");
  expect(() => assertFixturesPutBack(withoutAuthor)).toThrow(/the row is gone/);
  expect(() =>
    assertFixturesPutBack(withAccount(withoutAuthor, "e2e-admin", { name: "E2E Curator" })),
  ).toThrow(/- The "admin-account"[\s\S]*- The "author-account"/);
});

test("the declarations line up with the run they describe", () => {
  // A novel's owner is resolved by key when the seed writes it, and a window counted for an
  // account is keyed on that account's id: neither can name something the table does not declare.
  for (const novel of seededNovels()) {
    expect(readShared(novel.owner).kind).toBe("account");
  }
  for (const window of declaredWindows()) {
    const account = Object.keys(SHARED).includes(window.subject);
    const address = /^\d{1,3}(\.\d{1,3}){3}$/.test(window.subject);
    expect(account || address).toBe(true);
  }

  // A claim names the spec that takes it. A renamed spec file would leave the claim pointing at
  // nothing, which is a fixture nobody can spend and no test that says so.
  for (const claim of declaredClaims()) {
    expect(existsSync(join(e2eDir, `${claim.by}.spec.ts`))).toBe(true);
  }

  // The two uses the run hands a fixture back for, which is what the read-back holds it to: a
  // declaration that stopped saying so would quietly leave the check with nothing to check.
  expect(accountsToPutBack().map((claim) => `${claim.key}:${claim.use}:${claim.by}`)).toEqual([
    "admin-account:change:profile",
    "target-account:suspend:operator",
  ]);

  // Ids are what the seed writes and what a spec links to, so two rows may not share one.
  const ids = [...seededAccounts(), ...seededNovels()].map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);

  // And every stored session is signed for an account the seed writes.
  const emails = seededAccounts().map((account) => account.email);
  for (const session of storedSessions()) expect(emails).toContain(session.account.email);
});
