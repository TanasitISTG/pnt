import { config } from "dotenv";

config({ path: ".env.local" });
config();

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  console.error("TEST_DATABASE_URL is not set");
  process.exit(1);
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must not point at the application database");
  process.exit(1);
}

const parsedUrl = new URL(testDatabaseUrl);
const databaseName = parsedUrl.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(databaseName) || !/(^|_)(test|integration|e2e)(_|$)/.test(databaseName)) {
  console.error(
    `Refusing to migrate "${databaseName}": the database name must be a disposable test database`,
  );
  process.exit(1);
}

const maintenanceUrl = new URL(testDatabaseUrl);
maintenanceUrl.pathname = "/postgres";

const { default: postgres } = await import("postgres");
const client = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => {} });
try {
  const existing = await client`SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
  if (existing.length === 0) {
    console.log(`Creating database ${databaseName}...`);
    await client.unsafe(`CREATE DATABASE ${databaseName}`);
  }
} finally {
  await client.end({ timeout: 1 });
}

process.env.DATABASE_URL = testDatabaseUrl;
await import("./migrate.ts");
