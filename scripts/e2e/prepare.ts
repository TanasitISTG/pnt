import { mock } from "bun:test";
import { hashPassword } from "better-auth/crypto";

mock.module("server-only", () => ({}));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_e2e")) {
  throw new Error("Refusing to seed a database whose name does not end in _e2e");
}

const [{ db, queryClient }, schema, { encrypt }, { CURRENT_TERMS_VERSION }] = await Promise.all([
  import("../../src/lib/db/index.ts"),
  import("../../src/lib/db/schema/index.ts"),
  import("../../src/lib/settings/crypto.ts"),
  import("../../src/lib/terms.ts"),
]);

const userId = "e2e-admin";
const now = new Date();
await db.insert(schema.user).values({
  id: userId,
  name: "E2E Admin",
  email: "e2e-admin@example.test",
  emailVerified: true,
  image: null,
  // The operator role is granted out of band, exactly as a real deployment does it.
  role: "admin",
  // Seeded accounts stand in for real sign-ups, so they record the terms version the
  // create hook would have written: otherwise every scenario shows a re-acceptance
  // notice that no real account would be showing.
  termsVersion: CURRENT_TERMS_VERSION,
  termsAcceptedAt: now,
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

// A second, ordinary account. Moderation cannot target the acting operator, so the
// operator spec needs someone else to suspend, restore, and view as.
const memberId = "e2e-member";
await db.insert(schema.user).values({
  id: memberId,
  name: "E2E Member",
  email: "e2e-member@example.test",
  emailVerified: true,
  image: null,
  role: "user",
  termsVersion: CURRENT_TERMS_VERSION,
  termsAcceptedAt: now,
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.account).values({
  id: "e2e-member-account",
  accountId: memberId,
  providerId: "credential",
  userId: memberId,
  password: await hashPassword("e2e-member-password-123"),
  createdAt: now,
  updatedAt: now,
});

// A novel the member has not published. Impersonation is read-only, but reads are the
// point of it, so the operator spec opens this draft while viewing the account: it is
// exactly the resource a guest could never see.
const memberNovelId = "e2e-member-novel";
await db.insert(schema.novels).values({
  id: memberNovelId,
  userId: memberId,
  title: "Member Draft Novel",
  sourceLang: "en",
  targetLang: "th",
  storySummary: "A draft the operator can read and cannot change.",
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.chapters).values({
  id: "e2e-member-chapter",
  novelId: memberNovelId,
  number: "1",
  title: "Member Draft Chapter",
  rawContent: "Raw draft content.",
  rawCharCount: 19,
  status: "raw",
  createdAt: now,
  updatedAt: now,
});

// A published novel by a third account. The reporting spec needs live content that
// belongs to someone other than the reporter - an author cannot report their own novel -
// and a case that the operator therefore does not own either.
const authorId = "e2e-author";
await db.insert(schema.user).values({
  id: authorId,
  name: "E2E Author",
  email: "e2e-author@example.test",
  emailVerified: true,
  image: null,
  role: "user",
  termsVersion: CURRENT_TERMS_VERSION,
  termsAcceptedAt: now,
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.account).values({
  id: "e2e-author-account",
  accountId: authorId,
  providerId: "credential",
  userId: authorId,
  password: await hashPassword("e2e-author-password-123"),
  createdAt: now,
  updatedAt: now,
});

const reportedNovelId = "e2e-reported-novel";
const reportedChapterText = "Published source text for the reporting flow.";
await db.insert(schema.novels).values({
  id: reportedNovelId,
  userId: authorId,
  title: "E2E Reported Novel",
  sourceLang: "en",
  targetLang: "th",
  storySummary: "A live novel a member can report and an operator can review.",
  // Live, so any member can read it and be offered the report control.
  publishedAt: new Date(now.getTime() - 86_400_000),
  createdAt: now,
  updatedAt: now,
});
await db.insert(schema.chapters).values({
  id: "e2e-reported-chapter",
  novelId: reportedNovelId,
  number: "1",
  title: "E2E Reported Chapter",
  rawContent: reportedChapterText,
  translatedContent: "Translated text for the reporting flow.",
  rawCharCount: reportedChapterText.length,
  status: "translated",
  publishedAt: new Date(now.getTime() - 86_400_000),
  translatedAt: now,
  createdAt: now,
  updatedAt: now,
});

await queryClient.end({ timeout: 1 });
console.log("Seeded guarded E2E database");
