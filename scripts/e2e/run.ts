import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

import { requireDisposableDatabaseUrl, withDatabaseName } from "../../src/lib/db/database-url.ts";
import {
  describeFootprintCleanup,
  openBucketFootprint,
  removeAddedObjects,
  type BucketFootprint,
} from "../bucket-footprint.ts";

const root = resolve(import.meta.dir, "../..");
const artifactDir = resolve(root, ".tura/e2e");
const logDir = resolve(artifactDir, "logs");
const appUrl = "http://127.0.0.1:3000";
const inngestUrl = "http://127.0.0.1:8288";
const stubUrl = "http://127.0.0.1:4010";
const localPostgresPort = 55433;
const localPostgresData = resolve(artifactDir, "postgres-data");

// An empty value reads as "not configured", the way every other optional variable in this repo
// does (`.env.example` documents this one as empty by default, and `.env.local` is copied from
// it), so leaving it blank starts the ephemeral PostgreSQL below instead of refusing to run.
const externalDatabaseUrl = process.env.E2E_DATABASE_URL?.trim() || undefined;
const localDatabaseUrl = `postgresql://postgres@127.0.0.1:${localPostgresPort}/pnt_e2e`;
// The buckets are shared with the application and with the integration run, and this run writes to
// them through the app it starts: covers, a seeded profile photo, staged archives, cached exports.
// Its database is dropped at the end, so the rows that would own those objects go with it. The
// footprint taken below measures both buckets before anything starts and removes the sets this run
// created once every process it started has stopped (`scripts/bucket-footprint.ts`), under this same
// composed environment — which is also what makes the sweep reach the buckets the app used.
//
// The same guard every entry point that names a database goes through (`src/lib/db/database-url.ts`),
// with this run's own requirement on top of it: the database named here is dropped and re-created
// below, so only a `*_e2e` name is accepted. That is what keeps the run off the application's
// database and off the integration run's template, either of which reads as disposable already.
const { url: requestedUrl, name: databaseName } = requireDisposableDatabaseUrl(
  externalDatabaseUrl ?? localDatabaseUrl,
  "E2E_DATABASE_URL",
  { ending: "_e2e" },
);

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });

const environment = {
  ...process.env,
  // Pinned so a production NODE_ENV on the host cannot select the production env
  // schema, which requires Inngest Cloud keys this run deliberately leaves empty.
  NODE_ENV: "development",
  // The app ships Thai by default, and the browser suite asserts the English copy it has
  // always asserted, so the document language is pinned here exactly as `vite.config.ts`
  // pins it for the unit suite (i18n.md §7).
  VITE_DEFAULT_LOCALE: "en",
  DATABASE_URL: requestedUrl,
  // Migrations read the direct URL when one is configured, so it has to point at the
  // disposable database too: otherwise `db:migrate` lands on whatever host the
  // developer's .env.local names and the seed fails against an empty schema.
  DATABASE_URL_UNPOOLED: requestedUrl,
  TEST_DATABASE_URL: requestedUrl,
  E2E_DATABASE_URL: requestedUrl,
  BETTER_AUTH_SECRET: "e2e-secret-at-least-thirty-two-bytes",
  BETTER_AUTH_URL: appUrl,
  APP_ENCRYPTION_KEY: "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=",
  INNGEST_DEV: "1",
  INNGEST_BASE_URL: inngestUrl,
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
  // Pinned empty so a developer's own Cloudflare keys in .env.local cannot reach the
  // suite: with them present, sign-in and signup render a real challenge that the
  // test browser cannot solve, and every spec that signs in times out. Empty reads as
  // "not configured" in `src/lib/env.ts`, which is what lets dev, CI, and E2E agree.
  TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  E2E_APP_URL: appUrl,
  E2E_OPENAI_PORT: "4010",
  LOCAL_PROVIDER_ORIGINS: JSON.stringify([new URL(stubUrl).origin]),
  RATE_LIMIT_TRUSTED_PROXY_HOPS: "1",
  // Pinned empty, so the suite runs the shipped auth budget (ten per path per rolling minute)
  // whatever a developer's `.env.local` says: the sessions come from the fixture, which signs in
  // four times per run, instead of every spec signing in on the way past. Raised here before that
  // - a dozen sign-ins from one address in one window - and never in production.
  AUTH_RATE_LIMIT_MAX: "",
  PLAYWRIGHT_CHANNEL: detectBrowserChannel(),
  PORT: "3000",
  NITRO_PORT: "3000",
};

interface ManagedProcess {
  name: string;
  process: Bun.Subprocess;
  stdoutFd: number;
  stderrFd: number;
  stdoutPath: string;
  stderrPath: string;
}

const children: ManagedProcess[] = [];

function detectBrowserChannel(): string {
  if (process.env.PLAYWRIGHT_CHANNEL) return process.env.PLAYWRIGHT_CHANNEL;
  const chromePaths =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  if (chromePaths.some(existsSync)) return "chrome";
  const edgePaths =
    process.platform === "win32"
      ? [
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        ]
      : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];
  if (edgePaths.some(existsSync)) return "msedge";
  throw new Error("E2E requires an installed Chrome or Edge browser; no download is attempted");
}

function tail(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").split(/\r?\n/).slice(-30).join("\n");
}

function start(name: string, command: string[]): ManagedProcess {
  const stdoutPath = resolve(logDir, `${name}.stdout.log`);
  const stderrPath = resolve(logDir, `${name}.stderr.log`);
  mkdirSync(dirname(stdoutPath), { recursive: true });
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  const child: ManagedProcess = {
    name,
    stdoutFd,
    stderrFd,
    stdoutPath,
    stderrPath,
    process: Bun.spawn(command, {
      cwd: root,
      env: environment,
      stdout: stdoutFd,
      stderr: stderrFd,
      detached: process.platform !== "win32",
    }),
  };
  children.push(child);
  return child;
}

async function waitForHttp(name: string, url: string, child: ManagedProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.process.exitCode !== null) {
      throw new Error(
        `${name} exited before readiness (${child.process.exitCode}).\n${tail(child.stderrPath)}\n${tail(child.stdoutPath)}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Readiness is bounded below; transient connection failures are expected here.
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `${name} was not ready within ${timeoutMs}ms.\n${tail(child.stderrPath)}\n${tail(child.stdoutPath)}`,
  );
}

async function run(command: string[], label: string) {
  const child = Bun.spawn(command, {
    cwd: root,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${label} failed with exit code ${exitCode}`);
}

function postgresBinary(name: "initdb" | "postgres" | "pg_isready"): string {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    Bun.which(executable),
    ...(process.platform === "win32"
      ? [18, 17, 16, 15].map((version) =>
          resolve(`C:/Program Files/PostgreSQL/${version}/bin`, executable),
        )
      : [`/usr/lib/postgresql/18/bin/${name}`, `/usr/lib/postgresql/17/bin/${name}`]),
  ].filter((candidate): candidate is string => !!candidate);
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Could not find local PostgreSQL executable: ${executable}`);
  return found;
}

async function waitForPostgres(child: ManagedProcess, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const pgIsReady = postgresBinary("pg_isready");
  while (Date.now() < deadline) {
    if (child.process.exitCode !== null) {
      throw new Error(
        `PostgreSQL exited before readiness (${child.process.exitCode}).\n${tail(child.stderrPath)}\n${tail(child.stdoutPath)}`,
      );
    }
    const ready = Bun.spawnSync([
      pgIsReady,
      "-q",
      "-h",
      "127.0.0.1",
      "-p",
      String(localPostgresPort),
      "-d",
      "postgres",
      "-U",
      "postgres",
    ]);
    if (ready.exitCode === 0) return;
    await Bun.sleep(250);
  }
  throw new Error(`PostgreSQL was not ready within ${timeoutMs}ms.\n${tail(child.stderrPath)}`);
}

async function stop(child: ManagedProcess) {
  if (child.process.exitCode === null) {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(child.process.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } else {
      try {
        process.kill(-child.process.pid, "SIGTERM");
      } catch {
        child.process.kill("SIGTERM");
      }
    }
    await Promise.race([child.process.exited, Bun.sleep(5_000)]);
    if (child.process.exitCode === null) child.process.kill("SIGKILL");
  }
  closeSync(child.stdoutFd);
  closeSync(child.stderrFd);
}

let admin: ReturnType<typeof postgres> | undefined;
let footprint: BucketFootprint | null = null;

try {
  // The window opens here, before a single process of this run has written anything. A footprint
  // that cannot be read is reported and does not stop the run — this command's outcome is the
  // browser workflow — but it is loud, because it means the buckets will hold what this run writes.
  try {
    footprint = await openBucketFootprint(environment);
  } catch (error: unknown) {
    console.error(
      `The buckets could not be read before the run, so it will leave what it writes: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!externalDatabaseUrl) {
    mkdirSync(localPostgresData, { recursive: true });
    await run(
      [
        postgresBinary("initdb"),
        "--auth=trust",
        "--username=postgres",
        "--encoding=UTF8",
        "--no-locale",
        "-D",
        localPostgresData,
      ],
      "E2E PostgreSQL initialization",
    );
    const postgresProcess = start("postgres", [
      postgresBinary("postgres"),
      "-D",
      localPostgresData,
      "-p",
      String(localPostgresPort),
    ]);
    await waitForPostgres(postgresProcess);
  }

  // The same helper the migration scripts use to reach the server's own `postgres` database, so
  // the connection string is rewritten in one place rather than by hand in three.
  admin = postgres(withDatabaseName(requestedUrl, "postgres"), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  await run(["bun", "run", "db:migrate"], "E2E migration");
  await run(["bun", "scripts/e2e/prepare.ts"], "E2E seed");

  const stub = start("openai-stub", ["bun", "scripts/e2e/openai-stub.ts"]);
  await waitForHttp("OpenAI stub", `${stubUrl}/health`, stub);

  const app = start("app", [
    "bun",
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "3000",
  ]);
  await waitForHttp("application", appUrl, app, 120_000);

  const inngest = start("inngest", [
    "bunx",
    "inngest-cli",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "8288",
    "--no-discovery",
    "--sdk-url",
    `${appUrl}/api/inngest`,
    "--log-level",
    "warn",
  ]);
  await waitForHttp("Inngest", `${inngestUrl}/health`, inngest, 45_000);
  await Bun.sleep(5_000);

  await run(
    ["node", "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.config.ts"],
    "Playwright E2E",
  );
  console.log("E2E workflow passed");
} finally {
  // Everything this run started stops first: a process still running could write after the
  // buckets are read again, which is exactly the leftover this sweep exists to prevent.
  for (const child of children.toReversed()) await stop(child);

  if (footprint) {
    // Reported rather than thrown: the browser workflow's result is what this command reports, and
    // a sweep that fails here must not be read as a failing run.
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

  if (admin) {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end({ timeout: 1 });
  }
}
