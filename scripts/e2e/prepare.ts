import { mock } from "bun:test";
import { hashPassword } from "better-auth/crypto";

mock.module("server-only", () => ({}));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_e2e")) {
  throw new Error("Refusing to seed a database whose name does not end in _e2e");
}

const [{ db, queryClient }, schema, { encrypt }] = await Promise.all([
  import("../../src/lib/db/index.ts"),
  import("../../src/lib/db/schema/index.ts"),
  import("../../src/lib/translation/crypto.ts"),
]);

const userId = "e2e-admin";
const now = new Date();
await db.insert(schema.user).values({
  id: userId,
  name: "E2E Admin",
  email: "e2e-admin@example.test",
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.account).values({
  id: "e2e-account",
  accountId: userId,
  providerId: "credential",
  userId,
  password: await hashPassword("e2e-password-123"),
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.providerSettings).values({
  userId,
  provider: "openai",
  baseUrl: `http://127.0.0.1:${process.env.E2E_OPENAI_PORT ?? "4010"}/v1`,
  apiKeyEnc: encrypt("e2e-key"),
  model: "e2e-model",
  fastModel: "e2e-model",
  temperature: 0,
  requestTimeoutSec: 10,
  updatedAt: now,
});

await queryClient.end({ timeout: 1 });
console.log("Seeded guarded E2E database");
