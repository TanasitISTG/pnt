import { config } from "dotenv";

import {
  requireDisposableDatabaseUrl,
  withDatabaseName,
  type DisposableDatabase,
} from "@/lib/db/database-url";

config({ path: ".env.local" });
config();

// The same rule the integration suites' door applies (`src/test/integration.ts`), because this
// script creates the database that door opens.
let disposable: DisposableDatabase;
try {
  disposable = requireDisposableDatabaseUrl(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { name: databaseName } = disposable;
const testDatabaseUrl = disposable.url;
if (testDatabaseUrl === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must not point at the application database");
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const client = postgres(withDatabaseName(testDatabaseUrl, "postgres"), {
  max: 1,
  onnotice: () => {},
});
try {
  const existing = await client`SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
  if (existing.length === 0) {
    console.log(`Creating database ${databaseName}...`);
    await client.unsafe(`CREATE DATABASE ${databaseName}`);
  }
} finally {
  await client.end({ timeout: 1 });
}

// `migrate.ts` prefers the direct endpoint, so leaving `DATABASE_URL_UNPOOLED` alone
// would point the migration run at the application database even though
// `DATABASE_URL` now names the test database. Both must name the same disposable
// database for the run to be safe.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL_UNPOOLED = testDatabaseUrl;
await import("./migrate.ts");
