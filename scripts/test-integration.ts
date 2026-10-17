import postgres, { type Sql } from "postgres";

import { requireDisposableDatabaseUrl, withDatabaseName } from "@/lib/db/database-url";
import {
  INTEGRATION_DATABASE_VARIABLE,
  INTEGRATION_ENVIRONMENT,
  declaredIntegrationSuites,
  declaredSuiteFor,
  suiteDatabaseName,
} from "@/test/integration-declaration";

import {
  describeFootprintCleanup,
  openBucketFootprint,
  removeAddedObjects,
  type BucketFootprint,
} from "./bucket-footprint";

/**
 * Runs the integration suites, concurrently, each against a database of its own.
 *
 *   bun run test:integration                                  # every declared suite
 *   bun run test:integration -- lib/export/stream.integration.test.ts
 *
 * The file list is not here and not in `package.json`: it is `INTEGRATION_SUITES` in
 * `src/test/integration-declaration.ts`. The run and the declaration are one fact, so a suite added
 * to the tree is run once it is declared there, and `src/test/integration.test.ts` fails if the two
 * ever disagree — which is what the list repeated in `package.json` could not guarantee. A narrowed
 * run is the same list with a filter: a name the declaration does not have is refused rather than
 * handed to the runner as a path that matches nothing.
 *
 * Before Vitest starts, each selected suite's database is dropped if a previous run left one behind
 * and cloned from the template `TEST_DATABASE_URL` names, so a suite starts from the schema the
 * migrations produced and never from another suite's rows. That is what lets the suites run at the
 * same time: they share the server, not their data. The template is read here and then left alone —
 * a clone cannot start while it has another session — and suites never write to it, so whatever it
 * holds beyond the schema is the same for every clone and grows no further. The clones are left in
 * place after the run, so a failed suite can still be inspected; the next run replaces them.
 *
 * The buckets are shared with the application and with every other run, and the suites write to
 * them (covers, photos, cached exports, staged archives) against rows that die with the run. So the
 * run measures both buckets immediately before Vitest starts and removes the sets it created once
 * Vitest has exited (`scripts/bucket-footprint.ts`): one window around the whole run rather than one
 * per suite, because the suites run at the same time and a suite's cleanup could delete a set a
 * sibling was still asserting on. A cleanup that fails is reported and does not change the run's
 * exit code: the suites' outcome is what this command reports.
 */

/** Workers to run at once. Each suite holds its own client open, and Postgres's ceiling is a hundred. */
const MAX_WORKERS = 4;

/** A clone cannot start while the template has another session, which a health check can be. */
const CLONE_ATTEMPTS = 10;
const CLONE_RETRY_DELAY_MS = 200;

const requested = process.argv.slice(2);

let suites: readonly string[];
try {
  suites = requested.length > 0 ? requested.map(declaredSuiteFor) : declaredIntegrationSuites();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { url: templateUrl, name: template } = requireDisposableDatabaseUrl(
  process.env[INTEGRATION_DATABASE_VARIABLE],
  INTEGRATION_DATABASE_VARIABLE,
);
// The template is read and then left alone: a clone cannot start while it has another session.
const templateClient = postgres(templateUrl, { max: 1, onnotice: () => {} });
try {
  const [state] = await templateClient<{ migrated: boolean }[]>`
    SELECT to_regclass('public.novels') IS NOT NULL AS migrated
  `;
  if (!state?.migrated) {
    console.error(
      `The template database "${template}" has no schema. Run \`bun run db:migrate:test\` first.`,
    );
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    `The template database "${template}" could not be read. Run \`bun run db:migrate:test\` first.`,
  );
  process.exit(1);
} finally {
  await templateClient.end({ timeout: 1 });
}

const admin = postgres(withDatabaseName(templateUrl, "postgres"), {
  max: 1,
  onnotice: () => {},
});

try {
  for (const suite of suites) {
    const name = suiteDatabaseName(template, suite);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await cloneTemplate(admin, name, template);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    `Provisioning ${suites.length} suite database(s) from "${template}" failed. Is the template migrated (\`bun run db:migrate:test\`) and free of other sessions?`,
  );
  process.exit(1);
} finally {
  await admin.end({ timeout: 1 });
}

/**
 * The environment the run's workers get: what this shell already carries, plus what every suite
 * needs to load a server module at all (`INTEGRATION_ENVIRONMENT`, applied by the door in each
 * worker). The footprint reads the same buckets under the same schema the suites did, so it is
 * applied here too rather than relying on the shell being complete.
 */
function runEnvironment(): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = { ...process.env };
  for (const [key, { value }] of Object.entries(INTEGRATION_ENVIRONMENT)) {
    environment[key] ??= value;
  }
  return environment;
}

const environment = runEnvironment();
// The window: both buckets as they stand before a single suite has run. Taken here, after the
// databases are provisioned and immediately before Vitest starts, so nothing else this run does
// is measured as its own.
//
// A footprint that cannot be read is reported and does not stop the run: the suites need the
// database, and this command reports their outcome rather than the state of a bucket. Losing it is
// loud, because it means the buckets will hold whatever this run writes.
let footprint: BucketFootprint | null = null;
try {
  footprint = await openBucketFootprint(environment);
} catch (error: unknown) {
  console.error(
    `The buckets could not be read before the run, so it will leave what it writes: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const child = Bun.spawn(
  [
    process.execPath,
    "x",
    "vitest",
    "run",
    ...suites,
    `--maxWorkers=${MAX_WORKERS}`,
    "--reporter=dot",
  ],
  { stdout: "inherit", stderr: "inherit" },
);

const exitCode = await child.exited;

// After every suite has exited, so nothing can write into the window once it is read again. A sweep
// that fails here is reported rather than thrown: the suites' exit code is what this command
// reports, and a cleanup problem must not be read as a failing test run.
if (footprint) {
  try {
    const cleanup = await removeAddedObjects(footprint, environment);
    const summary = describeFootprintCleanup(cleanup);
    if (summary) console.log(`Bucket cleanup: ${summary}.`);
  } catch (error: unknown) {
    console.error(
      `The buckets could not be swept after the run, so it left what it wrote: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

process.exit(exitCode);

/** Copies the migrated template into `name`, waiting out a momentary session on the source. */
async function cloneTemplate(client: Sql, name: string, source: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${source}"`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contended = message.includes("being accessed by other users");
      if (!contended || attempt >= CLONE_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, CLONE_RETRY_DELAY_MS));
    }
  }
}
