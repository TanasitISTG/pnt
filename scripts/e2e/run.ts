import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const root = resolve(import.meta.dir, "../..");
const artifactDir = resolve(root, ".tura/e2e");
const logDir = resolve(artifactDir, "logs");
const appUrl = "http://127.0.0.1:3000";
const inngestUrl = "http://127.0.0.1:8288";
const stubUrl = "http://127.0.0.1:4010";
const localPostgresPort = 55433;
const localPostgresData = resolve(artifactDir, "postgres-data");

const externalDatabaseUrl = process.env.E2E_DATABASE_URL;
const requestedUrl =
  externalDatabaseUrl ?? `postgresql://postgres@127.0.0.1:${localPostgresPort}/pnt_e2e`;
const parsedUrl = new URL(requestedUrl);
const databaseName = parsedUrl.pathname.slice(1);
if (!/^[a-z0-9_]+_e2e$/.test(databaseName)) {
  throw new Error("E2E_DATABASE_URL must name a disposable database ending in _e2e");
}

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });

const environment = {
  ...process.env,
  DATABASE_URL: requestedUrl,
  TEST_DATABASE_URL: requestedUrl,
  E2E_DATABASE_URL: requestedUrl,
  BETTER_AUTH_SECRET: "e2e-secret-at-least-thirty-two-bytes",
  BETTER_AUTH_URL: appUrl,
  APP_ENCRYPTION_KEY: "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=",
  INNGEST_DEV: "1",
  INNGEST_BASE_URL: inngestUrl,
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
  E2E_APP_URL: appUrl,
  E2E_OPENAI_PORT: "4010",
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

try {
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

  const adminUrl = new URL(requestedUrl);
  adminUrl.pathname = "/postgres";
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
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
  await waitForHttp("application", appUrl, app, 45_000);

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
  await Bun.sleep(1_000);

  await run(
    ["node", "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.config.ts"],
    "Playwright E2E",
  );
  console.log("E2E workflow passed");
} finally {
  if (admin) {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end({ timeout: 1 });
  }
  for (const child of children.toReversed()) await stop(child);
}
