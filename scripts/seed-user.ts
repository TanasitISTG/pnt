import { mock } from "bun:test";
mock.module("server-only", () => ({}));

import { config } from "dotenv";

config({ path: ".env.local" });
config();

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

const args = process.argv.slice(2).reduce(
  (acc, arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key && value) acc[key] = value;
    return acc;
  },
  {} as Record<string, string>,
);

const email = args.email || process.env.SEED_ADMIN_EMAIL;
const name = args.name || process.env.SEED_ADMIN_NAME;
const password = args.password || process.env.SEED_ADMIN_PASSWORD;

if (!email || !name || !password) {
  console.error(
    "Usage: bun run seed:user --email=<email> --name=<name> --password=<password>\n" +
      "  or set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_PASSWORD in .env.local",
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const { db } = await import("../src/lib/db/index.ts");
const { user, account } = await import("../src/lib/db/schema/index.ts");

const now = new Date();
const userId = crypto.randomUUID();
const hashedPassword = await hashPassword(password);

const result = await db.transaction(async (tx) => {
  const [existing] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
    .for("update");

  if (existing) {
    const [credential] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")))
      .limit(1);
    if (credential) return "existing" as const;

    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: existing.id,
      providerId: "credential",
      userId: existing.id,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    });
    return "repaired" as const;
  }

  await tx.insert(user).values({
    id: userId,
    name,
    email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(account).values({
    id: crypto.randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: hashedPassword,
    createdAt: now,
    updatedAt: now,
  });
  return "created" as const;
});

if (result === "existing") {
  console.log(`User with email "${email}" already exists, skipping.`);
} else if (result === "repaired") {
  console.log(`Credential account added for existing admin: ${email}`);
} else {
  console.log(`Admin user created: ${email}`);
}
process.exit(0);
