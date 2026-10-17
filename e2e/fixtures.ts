/**
 * Everything the suite shares that is not a session: the rows the seed writes, the windows of the
 * app's own metering the run spends, and the app the specs point their own contexts at.
 *
 * `sessions.ts` holds the other half - the signed-in states, and what may end them - and the two
 * are separate modules because these declarations have a second reader. `scripts/e2e/prepare.ts`
 * seeds the database from them, so the ids, titles and accounts a spec asserts against and the rows
 * that actually exist are one declaration rather than two spellings of the same string kept in step
 * by hand. Nothing here imports Playwright, which is what lets the seed script import it.
 *
 * The declaration *is* the rule. `uses` names what a spec may do with a fixture beyond reading it,
 * and the one spec that may do it; `because` says what breaks otherwise and is what a refusal
 * quotes back. `readShared` hands a spec the ids, titles and limits; `claimShared` is the guarded
 * door for everything else, refusing a use the declaration does not name, a use that is another
 * spec's, and a second claim in one run. The rules that used to sit in a comment beside the code
 * that would break them sit here now, where the run's receipt can also print them.
 *
 * A claim that names `putBack` is the one case where what a spec may do and what has to be true
 * afterwards are two different things: the use changes the fixture rather than spending it, and the
 * spec it belongs to hands it back. `accountsToPutBack` reads those promises off the table, and
 * `assertFixturesPutBack` holds the run to them once it is over - so a rename left behind fails the
 * run that caused it, naming the spec that owned it, instead of the next spec that reads the name.
 */

/** The specs that take something beyond reading a fixture, by the name of the file they live in. */
export type SpecKey = "epub-rate-limit" | "guest-rate-limit" | "operator" | "profile" | "reports";

/** What one spec is allowed to take a fixture for, beyond reading it. */
interface Claim {
  readonly by: SpecKey;
}

/**
 * A use of a seeded account that changes it, and hands it back afterwards.
 *
 * The prose is what the spec puts back, written the way `because` is: it is quoted when the run
 * finds the account changed, and it is the only place the expectation is written down. Only an
 * account declares one, because an account's row is what the run knows how to read back
 * (`assertFixturesPutBack`); a use of a novel that had to be put back afterwards would need its own
 * reading here rather than a claim the check quietly skips.
 */
interface AccountClaim {
  readonly by: SpecKey;
  readonly putBack: string;
}

/** A chapter the seed writes: the number a reader sees, and the id the catalogue links to. */
export interface SeededChapter {
  readonly id: string;
  readonly title: string;
  readonly number: string;
}

/** The app the supervisor booted, at the fixed address every spec's own contexts point at. */
export interface SeededApp {
  readonly kind: "app";
  readonly url: string;
  readonly uses: Readonly<Record<string, Claim>>;
  readonly because: string;
}

/** An account the seed writes: signed in as, moderated, or reported against, never renamed. */
export interface SeededAccount {
  readonly kind: "account";
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: "admin" | "user";
  readonly uses: Readonly<Record<string, Claim | AccountClaim>>;
  readonly because: string;
}

/** A novel the seed writes, and the chapters of it a spec can name. */
export interface SeededNovel {
  readonly kind: "novel";
  readonly id: string;
  readonly title: string;
  readonly owner: AccountKey;
  readonly published: boolean;
  readonly chapters: readonly SeededChapter[];
  readonly uses: Readonly<Record<string, Claim>>;
  readonly because: string;
}

/** One window of the app's own metering, which a spec spends whole to watch the refusal. */
export interface MeteredWindow {
  readonly kind: "window";
  /** The bucket the app meters, as `checkRateLimit` and `checkRateLimitForSubject` name it. */
  readonly bucket: string;
  /**
   * Who the window is counted for: a client address the app reads off `x-forwarded-for`, or the
   * seeded account whose id the bucket is keyed on.
   */
  readonly subject: string;
  /** The app's own limit for one window, which is what a spender has to out-run. */
  readonly limit: number;
  readonly uses: Readonly<Record<string, Claim>>;
  readonly because: string;
}

/** Every shape a shared fixture can take. */
export type SharedFixture = SeededApp | SeededAccount | SeededNovel | MeteredWindow;

/**
 * What the run shares, declared once.
 *
 * `uses` is empty for the fixtures no spec may do anything to but read, which is most of them: the
 * seeded rows exist to be asserted against, and the specs that need to change something create
 * their own novel instead. The five claims below are the whole of what the run touches, and a run
 * that prints them says what it is about to do to its own fixtures.
 */
export const SHARED = {
  /** Where the suite's own app answers; `scripts/e2e/run.ts` boots it at the address it exports. */
  app: {
    kind: "app",
    url: process.env.E2E_APP_URL ?? "http://127.0.0.1:3000",
    uses: {},
    because:
      "The supervisor pins the port and the app's environment, so a spec that hardcoded an address " +
      "would be the only place a second one could come from.",
  },

  "admin-account": {
    kind: "account",
    id: "e2e-admin",
    name: "E2E Admin",
    email: "e2e-admin@example.test",
    password: "e2e-password-123",
    role: "admin",
    uses: { change: { by: "profile", putBack: "the seeded display name and no stored photo" } },
    because:
      "The operator every signed-in spec reads with. `profile.spec.ts` changes its display name and " +
      "photo and puts both back, and is the only spec that may: the header renders the seeded name, " +
      "which every other spec clicks by. Its remembered locale is nobody's to change - every spec " +
      "asserts the app's copy in English - which is why the specs that want Thai set the " +
      "`pnt-locale` cookie and leave the stored value alone (`locale.spec.ts`).",
  },

  "member-account": {
    kind: "account",
    id: "e2e-member",
    name: "E2E Member",
    email: "e2e-member@example.test",
    password: "e2e-member-password-123",
    role: "user",
    uses: {},
    because:
      "The ordinary account the reporting spec files as, and the owner of the draft the report " +
      "control must stay away from. Nothing suspends it or signs it out: banning an account deletes " +
      "every session it holds, and its stored session is still in use later in the run.",
  },

  "target-account": {
    kind: "account",
    id: "e2e-target",
    name: "E2E Target",
    email: "e2e-target@example.test",
    password: "e2e-target-password-123",
    role: "user",
    uses: { suspend: { by: "operator", putBack: "the account's cleared suspension" } },
    because:
      "The account the operator suspends, signs in as to watch the app refuse it, and restores. It " +
      "is deliberately not the member: a ban deletes the account's sessions, and the member's is " +
      "still needed minutes later. No spec signs in as this account otherwise, which is why it has " +
      "no stored session to lose.",
  },

  "author-account": {
    kind: "account",
    id: "e2e-author",
    name: "E2E Author",
    email: "e2e-author@example.test",
    password: "e2e-author-password-123",
    role: "user",
    uses: {},
    because:
      "It owns the one published novel that belongs to nobody else in the run, which is what a " +
      "report needs: an account cannot report its own novel, and the operator must not own the " +
      "case they decide. Nothing signs in as it.",
  },

  "member-novel": {
    kind: "novel",
    id: "e2e-member-novel",
    title: "Member Draft Novel",
    owner: "member-account",
    published: false,
    chapters: [{ id: "e2e-member-chapter", title: "Member Draft Chapter", number: "1" }],
    uses: {},
    because:
      "Unpublished, and owned by the account that reports: the reporting spec asserts the report " +
      "control is absent on it, which publishing it would take away.",
  },

  "target-novel": {
    kind: "novel",
    id: "e2e-target-novel",
    title: "Target Draft Novel",
    owner: "target-account",
    published: false,
    chapters: [{ id: "e2e-target-chapter", title: "Target Draft Chapter", number: "1" }],
    uses: {},
    because:
      "The draft of the account the operator views as: the resource a guest could never see, which " +
      "is what makes reading it through a read-only view mean something. It stays unpublished, " +
      "which is also why the reading page offers no chapter even to its owner.",
  },

  "reported-novel": {
    kind: "novel",
    id: "e2e-reported-novel",
    title: "E2E Reported Novel",
    owner: "author-account",
    published: true,
    chapters: [{ id: "e2e-reported-chapter", title: "E2E Reported Chapter", number: "1" }],
    uses: { report: { by: "reports" } },
    because:
      "Live and owned by a third account, so a member can read it and be offered the control. " +
      "Filing is the one use it gives: one open report per account per target is a partial unique " +
      "index, so a second filing in one run is refused by the database rather than by the app. The " +
      "decision the operator then records changes nothing about the novel.",
  },

  "guest-read-window": {
    kind: "window",
    bucket: "read",
    subject: "203.0.113.61",
    limit: 60,
    uses: { spend: { by: "guest-rate-limit" } },
    because:
      "A guest's reads are counted per client address, and the app takes that address from " +
      "`x-forwarded-for` because the suite runs with one trusted hop. The spec sends this address " +
      "and no other request in the run does, which is what lets it spend a whole window without " +
      "spending anyone else's.",
  },

  "admin-epub-window": {
    kind: "window",
    bucket: "epub-upload-create",
    subject: "admin-account",
    limit: 6,
    uses: { spend: { by: "epub-rate-limit" } },
    because:
      "Six uploads a minute for one account, and the spec deliberately spends all six to watch the " +
      "seventh be refused. `publish-translation.spec.ts` imports an EPUB archive as the same " +
      "account and draws on the same window, so it has to reach one of its own: the spec that " +
      "moves that import into this minute gets a 429 that reads like a product bug.",
  },
} as const satisfies Record<string, SeededApp | SeededAccount | SeededNovel | MeteredWindow>;

/** The keys a fixture is named by. */
export type SharedKey = keyof typeof SHARED;

/**
 * The keys that name a seeded account.
 *
 * Written out rather than read off the table, because a novel declares its owner and the table's
 * own key type does not exist until the table does. `fixtures.spec.ts` holds the two together:
 * it fails if a novel names an owner, or a window names an account, that is not declared as one.
 */
export type AccountKey = "admin-account" | "author-account" | "member-account" | "target-account";

/**
 * Hands a spec a fixture, for reading it: its ids, titles, addresses and limits.
 *
 * Reading is never refused - it changes nothing and spends nothing - so it asks for no identity.
 * Everything a spec does to a fixture beyond reading goes through `claimShared`, the guarded half
 * of this module.
 */
export function readShared<Key extends SharedKey>(key: Key): (typeof SHARED)[Key] {
  return guard.read(key);
}

/** The accounts the seed writes, in the order they are declared. */
export function seededAccounts(): readonly SeededAccount[] {
  return declaredFixtures().filter(
    (fixture): fixture is SeededAccount => fixture.kind === "account",
  );
}

/** The novels the seed writes, each with the chapters declared under it. */
export function seededNovels(): readonly SeededNovel[] {
  return declaredFixtures().filter((fixture): fixture is SeededNovel => fixture.kind === "novel");
}

/** The windows of the app's own metering the run draws on. */
export function declaredWindows(): readonly MeteredWindow[] {
  return declaredFixtures().filter(
    (fixture): fixture is MeteredWindow => fixture.kind === "window",
  );
}

/** Every fixture, in the order the table declares them, as the union of the shapes they take. */
function declaredFixtures(): readonly SharedFixture[] {
  return Object.values(SHARED);
}

/** Every fixture with the key the table names it by, in the order the table declares them. */
function keyedFixtures(): readonly (readonly [SharedKey, SharedFixture])[] {
  return Object.entries(SHARED) as readonly (readonly [SharedKey, SharedFixture])[];
}

/** Whether an entry is one of the seeded accounts, which narrows its key to an `AccountKey`. */
function isSeededAccount(
  entry: readonly [SharedKey, SharedFixture],
): entry is readonly [AccountKey, SeededAccount] {
  return entry[1].kind === "account";
}

/** Whether a use changes its fixture and hands it back, which is what the run reads back. */
function isPutBack(claim: Claim | AccountClaim): claim is AccountClaim {
  return "putBack" in claim;
}

/**
 * A declaration table, and the uses it has already given out, as one guarded lookup.
 *
 * The guard is built rather than fixed at module scope so that its refusals can be proved without
 * spending a claim the run needs: `fixtures.spec.ts` builds an instance over declarations of its
 * own. It is also the same shape as the session guard in `sessions.ts`, because a spec reaches for
 * a fixture and a session in the same spirit - naming the thing, and the use it means to put it to.
 */
export interface SharedGuard<Declarations extends Record<string, SharedFixture>> {
  /** The fixture's own declaration: its ids, titles, addresses and limits. */
  read<Key extends keyof Declarations & string>(key: Key): Declarations[Key];
  /**
   * Takes the one thing a spec may do with a fixture beyond reading it.
   *
   * `by` is the spec's own name, the way `takeSession`'s key is: nothing here can see who is
   * asking, so the caller states it and the declaration is compared against it. Three refusals
   * follow from that - a use this fixture does not declare, a use it declares for another spec,
   * and a second claim in the same run - and each one quotes the declaration's own account of why
   * the rule exists, because that prose is the only place the rule is written down.
   */
  claim<Key extends keyof Declarations & string>(
    key: Key,
    use: string,
    by: SpecKey,
  ): Declarations[Key];
}

/** Builds a guard over `declarations`, with its own record of what has been claimed. */
export function createSharedGuard<const Declarations extends Record<string, SharedFixture>>(
  declarations: Declarations,
): SharedGuard<Declarations> {
  const claimed = new Set<string>();
  return {
    read: (key) => declarations[key],
    claim(key, use, by) {
      const fixture: SharedFixture = declarations[key];
      const claim = fixture.uses[use] as Claim | undefined;
      const declared = Object.keys(fixture.uses);
      const taken = `${key}:${use}`;

      if (claimed.has(taken)) {
        throw new Error(
          `The "${key}" fixture has already been taken for ${use} in this run, so nothing here ` +
            "has a second one to give. A second spec that has to do this needs a fixture of its " +
            `own: declare it in \`SHARED\` (\`e2e/fixtures.ts\`). ${fixture.because}`,
        );
      }
      if (!claim) {
        const allowed =
          declared.length === 0
            ? "no spec may take it for anything but reading"
            : `the use it declares is ${declared.join(", ")}, not ${use}`;
        throw new Error(
          `The "${key}" fixture may not be taken for ${use}: ${allowed}. ${fixture.because}`,
        );
      }
      if (claim.by !== by) {
        throw new Error(
          `The "${key}" fixture may not be taken for ${use} by ${by}: the declaration gives that ` +
            `use to ${claim.by}. ${fixture.because}`,
        );
      }

      claimed.add(taken);
      return declarations[key];
    },
  };
}

/** The run's own guard, over the declarations above. */
const guard = createSharedGuard(SHARED);

/**
 * Takes the one thing a spec may do with a fixture beyond reading it.
 *
 * Hands over what the guard allows and refuses everything else; every claim a spec in this run
 * makes comes through here.
 */
export function claimShared<Key extends SharedKey>(
  key: Key,
  use: string,
  by: SpecKey,
): (typeof SHARED)[Key] {
  return guard.claim(key, use, by);
}

/** A claim the declarations give out, for the run to print alongside its session receipts. */
export interface DeclaredClaim {
  readonly fixture: SharedKey;
  readonly use: string;
  readonly by: SpecKey;
  /** Whether the spec puts the fixture back afterwards, rather than spending it for good. */
  readonly putBack: boolean;
}

/**
 * Every claim the declarations give out.
 *
 * Nothing consumes this but the receipt `global-setup.ts` prints: a run that says which spec
 * spends which window and which one owns the operator's stored profile is a run whose log can be
 * read when something breaks in the middle of it.
 */
export function declaredClaims(): readonly DeclaredClaim[] {
  const fixtures = Object.entries(SHARED) as [SharedKey, SharedFixture][];
  return fixtures.flatMap(([fixture, declaration]) =>
    Object.entries(declaration.uses).map(([use, claim]) => ({
      fixture,
      use,
      by: claim.by,
      putBack: isPutBack(claim),
    })),
  );
}

/**
 * An account a claim changes, and hands back: what `assertFixturesPutBack` holds the run to.
 *
 * Read off the table rather than declared a second time: the name the seed writes is what the run
 * looks for again, and the spec is the one the claim names - so a run that did not put an account
 * back fails naming the spec that owned it, not the next spec that read the name.
 */
export interface AccountPutBack {
  readonly key: AccountKey;
  /** The row the seed writes, which is what the run looks for again. */
  readonly id: string;
  /** The display name the seed writes. */
  readonly name: string;
  readonly use: string;
  readonly by: SpecKey;
  /** What that spec puts back, in the declaration's own words. */
  readonly putBack: string;
  /** The account's own account of why nothing else may change it, for a failure to quote. */
  readonly because: string;
}

/** The accounts the declarations say a spec changes and hands back, in the table's own order. */
export function accountsToPutBack(): readonly AccountPutBack[] {
  return keyedFixtures()
    .filter(isSeededAccount)
    .flatMap(([key, account]) =>
      Object.entries(account.uses).flatMap(([use, claim]) =>
        isPutBack(claim)
          ? [
              {
                key,
                id: account.id,
                name: account.name,
                use,
                by: claim.by,
                putBack: claim.putBack,
                because: account.because,
              },
            ]
          : [],
      ),
    );
}

/** What the run read back about one seeded account, so that a drift can be named precisely. */
export interface StoredAccount {
  readonly id: string;
  readonly name: string;
  /** The stored photo key, or `null` - the seed writes none. */
  readonly image: string | null;
  /** Whether the app still reads the account as suspended: `describeBan`, not the stored flag. */
  readonly suspended: boolean;
}

/**
 * Fails when an account the seed wrote is not found as the seed wrote it.
 *
 * An account is as the seed wrote it when it carries the name the table declares, no stored photo
 * and no suspension; `stored` is what the run read back, so this needs no database and is proved
 * in `fixtures.spec.ts` the way the guard's refusals are.
 *
 * Every seeded account is held to that, not only the two a spec claims. A claim is what allows a
 * spec to change a fixture, and reading the fixture back is what proves the change was undone - so
 * the same reading catches an account no claim gives anyone a use of, which today reads as a rename
 * that would break a later spec with no explanation anywhere.
 *
 * The failure names the fixture, the spec the declaration gives the use to, and what that spec
 * promised to put back; an account nothing may change is reported as such. Every account found
 * changed is listed rather than the first, because a run that broke two fixtures should say both.
 */
export function assertFixturesPutBack(stored: readonly StoredAccount[]): void {
  const found = new Map(stored.map((row) => [row.id, row]));
  const putBack = accountsToPutBack();

  const findings = keyedFixtures()
    .filter(isSeededAccount)
    .flatMap(([key, account]) => {
      const drift = describeAccountDrift(account, found.get(account.id));
      if (drift.length === 0) return [];
      const claim = putBack.find((declared) => declared.key === key);
      return [
        claim
          ? `The "${key}" fixture was not put back by ${claim.by}: ${drift.join(", ")}. The ` +
            `declaration has ${claim.by} putting the fixture back after ${claim.use}: ` +
            `${claim.putBack}. ${claim.because}`
          : `The "${key}" fixture is not as the seed wrote it: ${drift.join(", ")}. Nothing in ` +
            "the run gives any spec a use of it beyond reading, so nothing here was allowed to " +
            `change it. ${account.because}`,
      ];
    });

  if (findings.length === 0) return;
  throw new Error(
    "The run left the fixtures it shares not as the seed wrote them:\n" +
      findings.map((finding) => `- ${finding}`).join("\n") +
      "\nEvery account the seed writes is declared in `SHARED` (`e2e/fixtures.ts`), with the spec " +
      "allowed to change it and what that spec puts back afterwards; a change left behind is a " +
      "fixture the next spec reads and cannot explain.",
  );
}

/** What differs between the account the seed writes and the row the run found, in the app's words. */
function describeAccountDrift(
  account: SeededAccount,
  row: StoredAccount | undefined,
): readonly string[] {
  if (!row) return [`the row is gone, and the seed wrote ${account.id} (${account.email})`];

  const drift: string[] = [];
  if (row.name !== account.name) {
    drift.push(`the display name is "${row.name}" where the seed writes "${account.name}"`);
  }
  if (row.image !== null) drift.push("it carries a stored photo");
  if (row.suspended) drift.push("it is suspended");
  return drift;
}
