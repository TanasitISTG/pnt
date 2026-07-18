import { mock } from "bun:test";
mock.module("server-only", () => ({}));

import { config } from "dotenv";

config({ path: ".env.local" });
config();

import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

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
const { user, account } = await import("../src/lib/db/schema.ts");

const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);

if (existing.length > 0) {
  console.log(`User with email "${email}" already exists, skipping.`);
  process.exit(0);
}

const now = new Date();
const userId = crypto.randomUUID();
const hashedPassword = await hashPassword(password);

await db.insert(user).values({
  id: userId,
  name,
  email,
  emailVerified: true,
  image: null,
  createdAt: now,
  updatedAt: now,
});

await db.insert(account).values({
  id: crypto.randomUUID(),
  accountId: userId,
  providerId: "credential",
  userId,
  password: hashedPassword,
  createdAt: now,
  updatedAt: now,
});

console.log(`Admin user created: ${email}`);
