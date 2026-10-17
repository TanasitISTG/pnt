import { createHash } from "node:crypto";

/**
 * What the integration suites share, declared once.
 *
 * Seventeen `*.integration.test.ts` suites run concurrently, one Vitest worker each, and every one
 * of them gets a database of its own cloned from the migrated template `TEST_DATABASE_URL` names
 * (`suiteDatabaseName`, provisioned by `scripts/test-integration.ts`). A suite writes rows (named
 * with `randomUUID`) and leaves them, because the copy it writes to is thrown away and re-cloned
 * before the next run. That isolation is what lets the run be concurrent, and it is why nothing
 * here has to add "and no other suite is running at the same time".
 *
 * What stays shared is each worker's environment — `@/lib/env` is read when a server module first
 * loads, so the auth secret and the provider encryption key have to be in place before the suite
 * imports anything — and the allowances below.
 *
 * That arrangement used to be restated at the top of every suite: a block of assignments whose
 * order mattered, a comment per file explaining why, and allowances (a wider pool, databases of its
 * own) that nothing recorded. Here it is declared once:
 *
 * - `INTEGRATION_ENVIRONMENT` is what every worker gets, applied by the door rather than by the
 *   suite, in one place, before the first import.
 * - `INTEGRATION_ALLOWANCES` is the vocabulary for reaching past a suite's own rows and database.
 * - `INTEGRATION_SUITES` says which suite may claim which allowance. Its order is the order the run
 *   hands work to Vitest, and its entries are the run's file list.
 *
 * This module is deliberately data and pure functions only, because three readers need it and only
 * one of them should pay for a database client or a test runner: the run itself
 * (`scripts/test-integration.ts`) takes its file list and the databases to provision from it, the
 * door the suites go through (`src/test/integration.ts`) applies the environment and the allowances
 * and points at the suite's own database, and `src/test/integration.test.ts` holds all of it
 * against the files it names.
 */

/** The variable the run names its disposable database in. */
export const INTEGRATION_DATABASE_VARIABLE = "TEST_DATABASE_URL";

/**
 * The knobs every suite runs with: without them `@/lib/env` refuses to load, and a suite that
 * reaches a server module would fail on the schema rather than on its subject. A value the run
 * already carries stands, so a deployment's own secret is not replaced by a test literal.
 */
export const INTEGRATION_ENVIRONMENT = {
  BETTER_AUTH_SECRET: {
    value: "test-secret-at-least-thirty-two-bytes",
    because: "the schema requires a secret of at least 32 characters",
  },
  BETTER_AUTH_URL: {
    value: "http://localhost:3000",
    because: "Better Auth signs and verifies sessions against an origin",
  },
  APP_ENCRYPTION_KEY: {
    value: "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=",
    because:
      "provider keys are encrypted at rest, so a stored provider setting cannot be read without one",
  },
  INNGEST_DEV: {
    value: "1",
    because: "the SDK defaults to cloud mode and would want signing keys",
  },
} as const;

/**
 * A claim on something the run shares: without it a suite is expected to touch only rows it
 * wrote itself, in a database nothing else is using at that moment.
 */
export type IntegrationAllowance = "pool-for-row-locks" | "own-databases";

/** What an allowance is for, and what it grants. */
export interface IntegrationAllowanceDeclaration {
  /** Why a suite cannot do without it, in the terms the suite's own assertions use. */
  readonly because: string;
  /** The environment the allowance turns on, applied only for the suites that declare it. */
  readonly environment: Readonly<Record<string, string>>;
}

export const INTEGRATION_ALLOWANCES: Readonly<
  Record<IntegrationAllowance, IntegrationAllowanceDeclaration>
> = {
  "pool-for-row-locks": {
    because:
      "The suite pauses one transaction while a second must queue on the same novel row and then asserts that Postgres reports the waiter. The app's pooled client takes one connection in production, which would serialize the two client-side and leave the lock uncontended, so the run raises DATABASE_POOL_MAX for this suite.",
    environment: { DATABASE_POOL_MAX: "5" },
  },
  "own-databases": {
    because:
      "The suite migrates a database of its own: it creates a sibling database on the run's server, applies a partial migration history to it, and drops it again.",
    environment: {},
  },
};

/** What a suite declares about itself. */
export interface IntegrationSuite {
  /** The allowances this suite's declaration grants it, and nothing else. */
  readonly allow: readonly IntegrationAllowance[];
}

/**
 * Every suite the run visits, in the order it hands them to Vitest, with what each may claim
 * beyond its own rows and database. This is the run's file list as well as its declaration: a suite
 * that is not here is not run and cannot open the database at all.
 */
export const INTEGRATION_SUITES = {
  "src/lib/translation/workflow/workflow.integration.test.ts": { allow: ["pool-for-row-locks"] },
  "src/lib/inngest/outbox.integration.test.ts": { allow: [] },
  "src/lib/translation/workflow/chunk-migration.integration.test.ts": { allow: ["own-databases"] },
  "src/lib/export/stream.integration.test.ts": { allow: [] },
  "src/lib/content/novel-maintenance.integration.test.ts": { allow: ["pool-for-row-locks"] },
  "src/lib/content/chapter-edit.integration.test.ts": { allow: ["pool-for-row-locks"] },
  "src/lib/content/publish.integration.test.ts": { allow: [] },
  "src/lib/import/workflow.integration.test.ts": { allow: ["pool-for-row-locks"] },
  "src/lib/epub/import.integration.test.ts": { allow: ["pool-for-row-locks"] },
  "src/lib/job-dashboard/service.integration.test.ts": { allow: [] },
  "src/lib/glossary/service.integration.test.ts": { allow: [] },
  "src/lib/translation/evaluation/eval.integration.test.ts": { allow: [] },
  "src/lib/auth/session-revocation.integration.test.ts": { allow: [] },
  "src/lib/admin/moderation.integration.test.ts": { allow: [] },
  "src/lib/reports/report.integration.test.ts": { allow: [] },
  "src/lib/rate-limit.integration.test.ts": { allow: [] },
  "src/lib/reader/reader-state.integration.test.ts": { allow: ["pool-for-row-locks"] },
} as const satisfies Record<string, IntegrationSuite>;

/** The declarations keyed by suite path, for lookups by a path this process computed. */
const SUITE_DECLARATIONS: Readonly<Record<string, IntegrationSuite>> = INTEGRATION_SUITES;

/** The suites the run visits, in the order it visits them: the file list `test:integration` runs. */
export function declaredIntegrationSuites(): readonly string[] {
  return Object.keys(INTEGRATION_SUITES);
}

/** What a suite may claim, or `undefined` when the run does not visit that file. */
export function declarationFor(suite: string): IntegrationSuite | undefined {
  return SUITE_DECLARATIONS[suite];
}

/** The longest identifier PostgreSQL keeps; a longer name is cut, and two long names could meet. */
const MAX_IDENTIFIER_LENGTH = 63;

/** How much of the truncated form is the path's digest, which keeps the cut names apart. */
const DIGEST_LENGTH = 7;

/**
 * The database a suite runs against: the template's name plus the suite's own path.
 *
 * Every suite getting its own database is what lets the run be concurrent, and the name has to be
 * unique per suite, stable across runs, still readable as disposable, and inside PostgreSQL's
 * identifier limit — so a path long enough to overflow it is cut and ended with a digest of that
 * path. Nothing here creates anything: `scripts/test-integration.ts` clones the template under this
 * name before the run.
 */
export function suiteDatabaseName(template: string, suite: string): string {
  const slug = suite
    .replace(/\.integration\.test\.ts$/, "")
    .replace(/^src\//, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const name = `${template}_${slug}`;
  if (name.length <= MAX_IDENTIFIER_LENGTH) return name;

  const digest = createHash("sha256").update(suite).digest("hex").slice(0, DIGEST_LENGTH);
  return `${name.slice(0, MAX_IDENTIFIER_LENGTH - DIGEST_LENGTH - 1)}_${digest}`;
}

/**
 * The suite a caller named: the same match the door makes for a module URL, so a name that
 * arrives from outside — a full path, a path with `./` in front of it, or a Windows path — still
 * lands on the one declared suite it ends at.
 *
 * @throws when no declared suite matches, or when more than one does, because a narrowed run that
 * quietly ran nothing (or the wrong suite) is worse than a refusal.
 */
export function declaredSuiteFor(argument: string): string {
  const path = argument.replaceAll("\\", "/").replace(/^\.\//, "");
  const matches = declaredIntegrationSuites().filter(
    (suite) => path === suite || path.endsWith(`/${suite}`) || suite.endsWith(`/${path}`),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`"${argument}" names ${matches.length} declared suites: ${matches.join(", ")}`);
  }
  throw new Error(
    `${argument} is not a declared integration suite. The declaration names:\n  ${declaredIntegrationSuites().join("\n  ")}`,
  );
}

/** The suites whose declaration claims an allowance, in the run's order. */
export function suitesClaiming(allowance: IntegrationAllowance): string[] {
  return Object.entries(SUITE_DECLARATIONS)
    .filter(([, declaration]) => declaration.allow.includes(allowance))
    .map(([suite]) => suite);
}
