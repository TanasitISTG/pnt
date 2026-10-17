import postgres from "postgres";

import { describeBan } from "../src/lib/admin/ban-status";
import {
  accountsToPutBack,
  assertFixturesPutBack,
  seededAccounts,
  type StoredAccount,
} from "./fixtures";

/**
 * The run's own verdict on the fixtures it shared.
 *
 * A spec that changes a seeded account has to hand it back, and the declaration is what says so
 * (`putBack`, `e2e/fixtures.ts`). Until now the only thing that noticed a forgotten restore was
 * whichever spec next read the changed fixture: the operator's own spec clicks the header by the
 * seeded display name, so a name left behind surfaced there, as whatever that spec happened to be
 * asserting at the time. That is a fixture problem reported as a product bug.
 *
 * So the rows are read back out of the database once the tests are over, and the run fails naming
 * the fixture, the spec the declaration gives the use to and what that spec promised, before the
 * supervisor drops the database the evidence is in. Reading a row is all this does: it restores
 * nothing, and it fails nothing that a spec did not leave behind.
 *
 * A suspension is read through the app's own `describeBan`, not off the stored flag, because the
 * plugin leaves a lapsed ban in the row: an active account has to read as active here, exactly as
 * it does on the operator screen.
 */
export default async function globalTeardown(): Promise<void> {
  const accounts = seededAccounts();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log(
      "DATABASE_URL is unset, so the run cannot read back the accounts the seed writes: nothing " +
        "here proves that a spec put back what it changed.",
    );
    return;
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<StoredRow[]>`
      SELECT "id", "name", "image", "banned", "ban_expires"
      FROM "user"
      WHERE "id" IN ${sql(accounts.map((account) => account.id))}
    `;

    assertFixturesPutBack(rows.map(readStoredAccount));

    // The receipt, so the log of a run says which fixtures it was allowed to touch and left alone.
    const putBack = accountsToPutBack();
    console.log(
      `Read back all ${accounts.length} seeded accounts: ` +
        (putBack.length === 0
          ? "no spec may change one, and none did"
          : `${putBack.map((claim) => claim.key).join(" and ")} changed and put back again`),
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** The columns the check reads, as the `user` row holds them. */
interface StoredRow {
  id: string;
  name: string;
  image: string | null;
  banned: boolean | null;
  ban_expires: Date | null;
}

/** One row, read the way the app reads it. */
function readStoredAccount(row: StoredRow): StoredAccount {
  const ban = { banned: row.banned ?? false, banExpires: row.ban_expires };
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    suspended: describeBan(ban).state === "suspended",
  };
}
