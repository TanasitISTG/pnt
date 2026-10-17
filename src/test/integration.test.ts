import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isDisposableDatabaseName } from "@/lib/db/database-url";

import {
  INTEGRATION_ALLOWANCES,
  INTEGRATION_DATABASE_VARIABLE,
  INTEGRATION_ENVIRONMENT,
  declaredIntegrationSuites,
  declaredSuiteFor,
  suiteDatabaseName,
  suitesClaiming,
  type IntegrationAllowance,
} from "./integration-declaration";
import { closeIntegrationDatabase, openIntegrationDatabase } from "./integration";

/**
 * The declarations in `src/test/integration-declaration.ts`, held against the files they name.
 *
 * A declaration table is only worth having if something refuses to let it drift: a suite added to
 * the tree without a line in the table, a suite that keeps its own copy of the environment setup,
 * or an allowance granted for something the file no longer does all have to fail a test rather
 * than wait to be noticed in review. These read the sources, so they say what is in them.
 */

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

function readSource(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

/** Every integration suite in the tree, wherever it sits. */
function suiteFilesInTree(): string[] {
  return readdirSync(join(workspaceRoot, "src"), { recursive: true, encoding: "utf8" })
    .map((entry) => `src/${entry.replaceAll("\\", "/")}`)
    .filter((path) => path.endsWith(".integration.test.ts"))
    .toSorted();
}

function packageScripts(): Record<string, string> {
  const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  return scripts;
}

/** The runner `package.json` hands the integration suites to. */
function integrationRunner(): string {
  return (packageScripts()["test:integration"] ?? "").match(/scripts\/[\w./-]+\.ts/)?.[0] ?? "";
}

/** The suites, in declaration order, whose source contains a marker. */
function suitesContaining(marker: string | RegExp): string[] {
  return declaredIntegrationSuites().filter((suite) => readSource(suite).match(marker));
}

/** An assignment to the run's process environment, as opposed to reading it. */
const ENVIRONMENT_WRITE = /process\.env\.[A-Z_]+ *(?:\|\|=|=[^=])/;

/** A suite that takes the door's client, rather than only the database URL it names. */
const TAKES_A_CLIENT = /\{ sql \} = openIntegrationDatabase|openIntegrationDatabase\([^)]*\)\.sql/;

/** Ending the run's client by hand, which the door's own close replaces. */
const ENDS_THE_CLIENT_BY_HAND = /\b(?:sql|client)\??\.end\(/;

/** Handing the run's client back: either `afterAll(closeIntegrationDatabase)` or a plain call. */
const CLOSES_VIA_DOOR = /closeIntegrationDatabase\(\)|afterAll\(closeIntegrationDatabase\)/;

/** A database name PostgreSQL keeps whole: longer identifiers are cut, and two could meet. */
const MAX_IDENTIFIER_LENGTH = 63;

describe("the integration run's declarations", () => {
  it("runs every suite in the tree, and nothing else", () => {
    expect([...declaredIntegrationSuites()].toSorted()).toEqual(suiteFilesInTree());
  });

  it("takes the run's file list from the declaration instead of naming it twice", () => {
    expect(packageScripts()["test:integration"]).not.toMatch(/\.integration\.test\.ts/);
    expect(integrationRunner()).not.toBe("");
  });

  it("runs the declared suites concurrently, and narrows through the declaration", () => {
    const runner = readSource(integrationRunner());

    expect(runner).toContain("declaredIntegrationSuites()");
    expect(runner).toContain("declaredSuiteFor");
    expect(runner).not.toContain("--fileParallelism=false");
    expect(runner).toContain("--maxWorkers=");
  });

  it("gives every suite its own database, provisioned from the declaration's naming rule", () => {
    const runner = readSource(integrationRunner());

    expect(runner).toContain("suiteDatabaseName(");
  });

  it("names each suite's database uniquely, permanently and within PostgreSQL's limit", () => {
    const template = "pnt_integration";
    const names = declaredIntegrationSuites().map((suite) => suiteDatabaseName(template, suite));

    expect(names).toEqual([...new Set(names)]);
    expect(names.filter((name) => name.length > MAX_IDENTIFIER_LENGTH)).toEqual([]);
    expect(names.filter((name) => !isDisposableDatabaseName(name))).toEqual([]);
    for (const suite of declaredIntegrationSuites()) {
      expect(suiteDatabaseName(template, suite)).toBe(suiteDatabaseName(template, suite));
    }
  });

  it("keeps a long path's database name inside the limit without letting two suites meet", () => {
    const template = "pnt_integration_with_a_deliberately_long_name";
    const deep = "src/lib/translation/workflow/very/deeply/nested/suite-name.integration.test.ts";
    const other = "src/lib/translation/workflow/very/deeply/nested/other-name.integration.test.ts";

    for (const suite of [deep, other]) {
      expect(suiteDatabaseName(template, suite).length).toBeLessThanOrEqual(MAX_IDENTIFIER_LENGTH);
    }
    expect(suiteDatabaseName(template, deep)).not.toBe(suiteDatabaseName(template, other));
  });

  it("resolves a narrowed run from however much of a suite's path is given", () => {
    for (const suite of declaredIntegrationSuites()) {
      expect(declaredSuiteFor(suite)).toBe(suite);
      expect(declaredSuiteFor(`./${suite}`)).toBe(suite);
      expect(declaredSuiteFor(suite.replace(/^src\//, ""))).toBe(suite);
      expect(declaredSuiteFor(suite.replaceAll("/", "\\"))).toBe(suite);
    }
  });

  it("refuses a narrowed run that names no suite, or more than one", () => {
    expect(() => declaredSuiteFor("src/lib/undeclared.integration.test.ts")).toThrow(
      /is not a declared integration suite/,
    );
    expect(() => declaredSuiteFor("")).toThrow(/is not a declared integration suite/);
    expect(() => declaredSuiteFor("service.integration.test.ts")).toThrow(
      /names \d+ declared suites/,
    );
  });

  it("sends every suite through the door before it touches the database", () => {
    const withoutDoor = declaredIntegrationSuites().filter(
      (suite) => !readSource(suite).includes("openIntegrationDatabase(import.meta.url"),
    );

    expect(withoutDoor).toEqual([]);
  });

  it("leaves the process's environment to the door, so no suite sets it up itself", () => {
    const settingTheirOwn = declaredIntegrationSuites().filter((suite) =>
      ENVIRONMENT_WRITE.test(readSource(suite)),
    );

    expect(settingTheirOwn).toEqual([]);
  });

  it("opens one suite per file", () => {
    const duplicated = declaredIntegrationSuites().filter(
      (suite) => readSource(suite).split("describeIntegration(").length !== 2,
    );

    expect(duplicated).toEqual([]);
  });

  it("hands the run's client back to the door, so no suite holds its lifetime", () => {
    expect(suitesContaining(TAKES_A_CLIENT)).toEqual(suitesContaining(CLOSES_VIA_DOOR));
  });

  it("never ends the run's client by hand", () => {
    expect(suitesContaining(ENDS_THE_CLIENT_BY_HAND)).toEqual([]);
  });

  it("only grants the wider pool to the suites that wait on a row lock", () => {
    expect(suitesContaining("wait_event_type")).toEqual(suitesClaiming("pool-for-row-locks"));
  });

  it("only grants databases of its own to the suite that migrates one", () => {
    expect(suitesContaining("CREATE DATABASE")).toEqual(suitesClaiming("own-databases"));
  });

  it("keeps no allowance that nothing claims and no suite that claims nothing", () => {
    const unclaimed = (Object.keys(INTEGRATION_ALLOWANCES) as IntegrationAllowance[]).filter(
      (allowance) => suitesClaiming(allowance).length === 0,
    );

    expect(unclaimed).toEqual([]);
  });

  it("asks every allowance and every environment knob to say why it exists", () => {
    const withoutReason = [
      ...Object.entries(INTEGRATION_ALLOWANCES),
      ...Object.entries(INTEGRATION_ENVIRONMENT),
    ]
      .filter(([, declaration]) => declaration.because.trim().length === 0)
      .map(([name]) => name);

    expect(withoutReason).toEqual([]);
  });
});

describe("the door", () => {
  afterEach(async () => {
    // The door holds an open until it is handed back, so leave the next test a free one.
    await closeIntegrationDatabase();
    vi.unstubAllEnvs();
  });

  it("refuses a suite its declaration does not name", () => {
    const undeclared = pathToFileURL(
      join(workspaceRoot, "src/lib/undeclared.integration.test.ts"),
    ).href;

    expect(() => openIntegrationDatabase(undeclared)).toThrow(
      /is not declared in INTEGRATION_SUITES/,
    );
    expect(() => openIntegrationDatabase("file:///nowhere/at/all")).toThrow(
      /is not declared in INTEGRATION_SUITES/,
    );
  });

  it("refuses a run whose database does not read as disposable", () => {
    vi.stubEnv(
      INTEGRATION_DATABASE_VARIABLE,
      "postgresql://avnadmin:secret@db.example:15639/defaultdb",
    );

    expect(() => openIntegrationDatabase(aDeclaredSuite())).toThrow(
      /TEST_DATABASE_URL must name a disposable database/,
    );
  });

  it("refuses a run with no database to point at", () => {
    vi.stubEnv(INTEGRATION_DATABASE_VARIABLE, "");

    expect(() => openIntegrationDatabase(aDeclaredSuite())).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("refuses a suite that opens the run's database twice", () => {
    vi.stubEnv(INTEGRATION_DATABASE_VARIABLE, aDisposableDatabase());
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "");

    openIntegrationDatabase(aDeclaredSuite());

    expect(() => openIntegrationDatabase(aDeclaredSuite())).toThrow(
      /has already opened the run's database/,
    );
  });

  it("closes nothing when the suite never opened the client, and closes once", async () => {
    vi.stubEnv(INTEGRATION_DATABASE_VARIABLE, aDisposableDatabase());
    vi.stubEnv("DATABASE_URL", process.env.DATABASE_URL ?? "");

    const database = openIntegrationDatabase(aDeclaredSuite());

    await expect(database.close()).resolves.toBeUndefined();
    await expect(closeIntegrationDatabase()).resolves.toBeUndefined();
    await expect(closeIntegrationDatabase()).resolves.toBeUndefined();
  });
});

/** A database the rule accepts, so the door gets past the URL check without connecting. */
function aDisposableDatabase(): string {
  return "postgresql://postgres:postgres@localhost:5432/pnt_integration";
}

/** The URL of any declared suite: the door refuses on the database, not on the file. */
function aDeclaredSuite(): string {
  const suite = declaredIntegrationSuites()[0];
  if (!suite) throw new Error("the run declares no suites");
  return pathToFileURL(join(workspaceRoot, suite)).href;
}
