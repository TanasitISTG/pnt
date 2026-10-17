import { fileURLToPath } from "node:url";

import postgres, { type Sql } from "postgres";
import { describe } from "vitest";

import { requireDisposableDatabaseUrl, withDatabaseName } from "@/lib/db/database-url";
import {
  INTEGRATION_ALLOWANCES,
  INTEGRATION_DATABASE_VARIABLE,
  INTEGRATION_ENVIRONMENT,
  declarationFor,
  declaredIntegrationSuites,
  suiteDatabaseName,
} from "./integration-declaration";

/**
 * The door: how a suite gets the database, the environment and the allowances its declaration
 * names, and how it gives the connection back.
 *
 * `src/test/integration-declaration.ts` holds what the run shares; this module is the part that
 * needs a client and a test runner, so the run's file list and the declaration test can read the
 * table without loading either.
 *
 * Call `openIntegrationDatabase(import.meta.url)` first in `beforeAll`, before importing any
 * server module. It points the suite at its own database — the template `TEST_DATABASE_URL` names,
 * cloned per suite by the run — and applies the environment, refusing a suite the run does not
 * declare, a suite that already opened the database, and a `TEST_DATABASE_URL` that is unset or
 * does not name a disposable database. It grants exactly what that suite's declaration claims: a
 * suite cannot raise its own pool. Hand the connection back with `closeIntegrationDatabase` in
 * `afterAll`: the door opened it, so the door ends it, and its shutdown timeout is stated once
 * rather than once per suite.
 */

/** The run has a disposable database to point at, or every suite skips itself. */
export const describeIntegration = process.env[INTEGRATION_DATABASE_VARIABLE]
  ? describe
  : describe.skip;

export interface IntegrationDatabase {
  /** This suite's own database, cloned from the one the run names. */
  readonly databaseUrl: string;
  /** This suite's own client, opened the first time it is used. */
  readonly sql: Sql;
  /** Ends that client, if the suite ever opened one. Safe to call twice. */
  close(): Promise<void>;
}

export interface OpenIntegrationDatabaseOptions {
  /** Connections this suite's own client holds open. Unused when the suite never opens one. */
  connections?: number;
}

/** Enough for a suite that reads while a statement of its own is still running. */
const DEFAULT_CONNECTIONS = 2;

/**
 * The client this suite opened, so that the suite never has to hold the lifetime itself. Vitest
 * gives each test file its own module registry, so this is one suite's, not the run's.
 */
let openDatabase: IntegrationDatabase | null = null;

/**
 * Points the process at the run's disposable database and hands back the suite's own client.
 *
 * Call it first in `beforeAll`, before importing any server module: `@/lib/db` reads `DATABASE_URL`
 * when it loads.
 *
 * @param moduleUrl The suite's own `import.meta.url` — the declaration is looked up by file, so a
 * suite cannot claim another one's allowances.
 * @throws when the run does not declare the file, when this suite has already opened the database,
 * or when `TEST_DATABASE_URL` is unset or does not name a disposable database.
 */
export function openIntegrationDatabase(
  moduleUrl: string,
  options: OpenIntegrationDatabaseOptions = {},
): IntegrationDatabase {
  const suite = suitePathOf(moduleUrl);
  const declaration = declarationFor(suite);
  if (!declaration) {
    throw new Error(
      `${suite} is not declared in INTEGRATION_SUITES (src/test/integration-declaration.ts): a suite says what it shares with the run before it opens the database.`,
    );
  }
  if (openDatabase) {
    // Two clients would mean the first is never handed back, which is the leak this door exists
    // to prevent: a suite opens the run's database once, in `beforeAll`.
    throw new Error(
      `${suite} has already opened the run's database. A suite opens it once and hands it back with \`closeIntegrationDatabase\` in \`afterAll\`.`,
    );
  }

  const { url: templateUrl, name: template } = requireDisposableDatabaseUrl(
    process.env[INTEGRATION_DATABASE_VARIABLE],
    INTEGRATION_DATABASE_VARIABLE,
  );
  // This suite's own copy of the template, which `scripts/test-integration.ts` created. Suites run
  // at the same time, so one shared database would make every suite's rows everyone else's.
  const databaseUrl = withDatabaseName(templateUrl, suiteDatabaseName(template, suite));

  // Unconditional: the application's own URL is normally right there in the environment, and
  // reaching it would write to real data.
  process.env.DATABASE_URL = databaseUrl;
  for (const [key, { value }] of Object.entries(INTEGRATION_ENVIRONMENT)) {
    process.env[key] ||= value;
  }
  for (const allowance of declaration.allow) {
    for (const [key, value] of Object.entries(INTEGRATION_ALLOWANCES[allowance].environment)) {
      process.env[key] ||= value;
    }
  }

  const connections = options.connections ?? DEFAULT_CONNECTIONS;
  let client: Sql | null = null;

  const database: IntegrationDatabase = {
    databaseUrl,
    get sql(): Sql {
      // A suite that only needs the URL — the migration suite works on databases it creates —
      // never opens a connection to the run's own.
      client ??= postgres(databaseUrl, { max: connections, onnotice: () => {} });
      return client;
    },
    async close() {
      if (!client) return;
      const ending = client;
      client = null;
      // A teardown has nothing left to wait for, and the process may not outlive it long enough
      // to wait anyway.
      await ending.end({ timeout: 1 });
    },
  };

  openDatabase = database;
  return database;
}

/**
 * Hands the connection back: `afterAll(closeIntegrationDatabase)`, or as the last statement of an
 * `afterAll` that cleans up after itself first. A suite that never opened the client closes
 * nothing, and calling this twice is safe.
 */
export async function closeIntegrationDatabase(): Promise<void> {
  const database = openDatabase;
  openDatabase = null;
  await database?.close();
}

/** The workspace-relative path of the file a suite runs from. */
function suitePathOf(moduleUrl: string): string {
  let path: string;
  try {
    path = fileURLToPath(moduleUrl).replaceAll("\\", "/");
  } catch {
    // Not a file URL this process can resolve. The declaration check refuses it, naming what it
    // was handed instead of failing on the platform's URL rules.
    return moduleUrl;
  }
  const root = process.cwd().replaceAll("\\", "/").replace(/\/+$/, "");
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);

  // A worker whose working directory is not the workspace root still names the file it runs.
  const matches = declaredIntegrationSuites().filter(
    (suite) => path === suite || path.endsWith(`/${suite}`),
  );
  return matches.length === 1 ? matches[0] : path;
}
