/**
 * The rule that keeps a run out of the application's database.
 *
 * `scripts/migrate-test-db.ts` creates and migrates the database `TEST_DATABASE_URL` names, and the
 * integration suites write rows into it and leave them there, because the database is expected to
 * be thrown away. Every entry point that names a database therefore has to refuse a URL that names
 * a real one, and all of them have to agree on what refusing means: the suites' door
 * (`src/test/integration.ts`) points the process at that database, `scripts/test-integration.ts`
 * clones it per suite, and the E2E supervisor (`scripts/e2e/run.ts`, seeded by
 * `scripts/e2e/prepare.ts`) names one of its own to drop, re-create and fill.
 *
 * The predicate lives here so there is one rule rather than one copy per caller. The supervisor's
 * `_e2e` requirement is a requirement *on* that rule rather than a second reading of the name: "may
 * this database be thrown away?" is the same question there, and `_e2e` only adds which run's
 * database it is.
 */

/** The database a connection string names, or `null` when it names none or cannot be parsed. */
export function databaseNameOf(url: string): string | null {
  try {
    const name = new URL(url).pathname.replace(/^\//, "");
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Whether a database name says it is disposable: lowercase snake case with a `test`,
 * `integration` or `e2e` word of its own. A name that merely contains one (`pnt_latest`) is not
 * a disposable database, and neither is a name that cannot be written unquoted
 * (`Production-DB`), because Postgres would fold or reject it into something else.
 */
export function isDisposableDatabaseName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name) && /(^|_)(test|integration|e2e)(_|$)/.test(name);
}

/**
 * The same connection string, pointed at another database on the same server. Used to give a
 * caller its own database without asking it to know the server's credentials, and written the way
 * the migration scripts write it: parse, replace the database, serialize.
 */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * A connection string that passed the rule, with the database name that made it pass.
 */
export interface DisposableDatabase {
  /** The connection string, as its variable held it. */
  readonly url: string;
  /** The database it names. */
  readonly name: string;
}

/**
 * What a caller needs beyond "disposable": which run's database this has to be.
 */
export interface DisposableDatabaseRequirement {
  /**
   * A suffix the name must also carry. The E2E supervisor drops and re-creates the database it is
   * handed, so a name that reads as disposable but belongs to another run — `pnt_integration`, the
   * integration run's template — would be destroyed by it. It asks for `_e2e`, which is what keeps
   * the two runs on databases of their own.
   */
  readonly ending?: string;
}

/**
 * The database to run against, or a refusal naming the variable it came from.
 *
 * @throws when the variable is unset, unparseable, or names a database that does not read as
 * disposable — a suite that reaches production data has no way to report that as a test failure —
 * or when the caller required an ending the name does not have.
 */
export function requireDisposableDatabaseUrl(
  value: string | undefined,
  variable: string,
  requirement: DisposableDatabaseRequirement = {},
): DisposableDatabase {
  if (!value) {
    throw new Error(`${variable} is not set: the database has to be a disposable one`);
  }
  const name = databaseNameOf(value);
  if (!name || !isDisposableDatabaseName(name)) {
    throw new Error(
      `Refusing "${name ?? value}": ${variable} must name a disposable database, so its name has to carry test, integration or e2e`,
    );
  }
  const { ending } = requirement;
  if (ending && !name.endsWith(ending)) {
    throw new Error(
      `Refusing "${name}": ${variable} must name a disposable database ending in ${ending}`,
    );
  }
  return { url: value, name };
}
