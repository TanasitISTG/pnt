import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  databaseNameOf,
  isDisposableDatabaseName,
  requireDisposableDatabaseUrl,
  withDatabaseName,
} from "./database-url";

describe("databaseNameOf", () => {
  it("reads the database from a connection string", () => {
    expect(
      databaseNameOf("postgresql://user:pass@localhost:5432/pnt_integration?sslmode=require"),
    ).toBe("pnt_integration");
  });

  it.each([
    ["a server without a database", "postgresql://user:pass@localhost:5432"],
    ["a trailing slash", "postgresql://user:pass@localhost:5432/"],
    ["not a URL", "postgres://"],
  ])("reads %s as no database", (_case, url) => {
    expect(databaseNameOf(url)).toBeNull();
  });
});

describe("isDisposableDatabaseName", () => {
  it.each(["pnt_test", "pnt_integration", "pnt_e2e", "pnt_integration_backup", "test"])(
    "accepts %s",
    (name) => {
      expect(isDisposableDatabaseName(name)).toBe(true);
    },
  );

  it.each([
    ["the application database", "defaultdb"],
    ["a name that only contains the word", "pnt_latest"],
    ["a numbered suffix", "pnt_integration2"],
    ["upper case, which Postgres would fold", "PNT_INTEGRATION"],
    ["a hyphen, which needs quoting", "pnt-integration"],
    ["empty", ""],
  ])("refuses %s", (_case, name) => {
    expect(isDisposableDatabaseName(name)).toBe(false);
  });
});

describe("withDatabaseName", () => {
  it("points the same connection string at another database", () => {
    expect(
      withDatabaseName(
        "postgresql://user:pass@localhost:5432/pnt_integration?sslmode=require",
        "pnt_integration_lib_export_stream",
      ),
    ).toBe(
      "postgresql://user:pass@localhost:5432/pnt_integration_lib_export_stream?sslmode=require",
    );
  });

  it("keeps a name the rule accepts, so a clone is as disposable as its template", () => {
    const clone = withDatabaseName(
      "postgresql://user:pass@localhost:5432/pnt_integration",
      "pnt_integration_lib_export_stream",
    );

    expect(databaseNameOf(clone)).toBe("pnt_integration_lib_export_stream");
    expect(isDisposableDatabaseName(databaseNameOf(clone) ?? "")).toBe(true);
  });
});

describe("requireDisposableDatabaseUrl", () => {
  it("returns the URL it was given a disposable name for, with the name it read", () => {
    const url = "postgresql://postgres:postgres@localhost:5432/pnt_integration";

    expect(requireDisposableDatabaseUrl(url, "TEST_DATABASE_URL")).toEqual({
      url,
      name: "pnt_integration",
    });
  });

  it("names the variable when it is unset", () => {
    expect(() => requireDisposableDatabaseUrl(undefined, "TEST_DATABASE_URL")).toThrow(
      "TEST_DATABASE_URL is not set",
    );
  });

  it("refuses a URL that names the application's database", () => {
    expect(() =>
      requireDisposableDatabaseUrl(
        "postgresql://avnadmin:secret@db.example:15639/defaultdb",
        "DATABASE_URL",
      ),
    ).toThrow(
      'Refusing "defaultdb": DATABASE_URL must name a disposable database, so its name has to carry test, integration or e2e',
    );
  });
});

describe("a caller's own requirement on top of the rule", () => {
  it("keeps a disposable name that carries the ending the caller asked for", () => {
    const url = "postgresql://postgres@127.0.0.1:55433/pnt_e2e";

    expect(requireDisposableDatabaseUrl(url, "E2E_DATABASE_URL", { ending: "_e2e" })).toEqual({
      url,
      name: "pnt_e2e",
    });
  });

  it("refuses another run's disposable database", () => {
    expect(() =>
      requireDisposableDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/pnt_integration",
        "E2E_DATABASE_URL",
        { ending: "_e2e" },
      ),
    ).toThrow(
      'Refusing "pnt_integration": E2E_DATABASE_URL must name a disposable database ending in _e2e',
    );
  });

  it("refuses a name the ending is only part of", () => {
    expect(() =>
      requireDisposableDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/pnt_e2e_backup",
        "E2E_DATABASE_URL",
        { ending: "_e2e" },
      ),
    ).toThrow(/must name a disposable database ending in _e2e/);
  });

  it("refuses the application's database on the rule, not on the ending", () => {
    expect(() =>
      requireDisposableDatabaseUrl(
        "postgresql://avnadmin:secret@db.example:15639/defaultdb",
        "E2E_DATABASE_URL",
        { ending: "_e2e" },
      ),
    ).toThrow(/must name a disposable database, so its name has to carry test, integration or e2e/);
  });

  it("asks for nothing extra by default", () => {
    expect(() =>
      requireDisposableDatabaseUrl(
        "postgresql://postgres:postgres@localhost:5432/pnt_integration",
        "TEST_DATABASE_URL",
      ),
    ).not.toThrow();
  });
});

/**
 * The rule is one thing, so the entry points that name a database read it in one place.
 *
 * Each of these names a database, and each has to refuse one that is not disposable before it
 * migrates, clones, drops or fills it. A copy of the test in one of them is how they drift: the
 * E2E supervisor and its seed each used to spell out an `_e2e` rule of their own, so a name one
 * accepted the other refused.
 */
const DATABASE_ENTRY_POINTS = [
  "scripts/migrate-test-db.ts",
  "scripts/test-integration.ts",
  "scripts/e2e/run.ts",
  "scripts/e2e/prepare.ts",
  "src/test/integration.ts",
] as const;

/** A module testing a database name itself: a regex anchored on the ending, or a suffix test. */
const TESTS_A_NAME_BY_HAND = /_e2e\$(?=\/)|endsWith\(["']_e2e["']\)/;

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readSource(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

describe("the entry points that name a database", () => {
  it.each(DATABASE_ENTRY_POINTS)("%s goes through the one guard", (path) => {
    expect(readSource(path)).toContain("requireDisposableDatabaseUrl(");
  });

  it("leaves no copy of the rule in any of them", () => {
    const byHand = DATABASE_ENTRY_POINTS.filter((path) =>
      TESTS_A_NAME_BY_HAND.test(readSource(path)),
    );

    expect(byHand).toEqual([]);
  });
});
