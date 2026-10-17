import { mock } from "bun:test";
import { hashPassword } from "better-auth/crypto";

import { requireDisposableDatabaseUrl } from "../../src/lib/db/database-url.ts";
import {
  readShared,
  seededAccounts,
  seededNovels,
  type SeededAccount,
  type SeededNovel,
} from "../../e2e/fixtures.ts";

mock.module("server-only", () => ({}));

// The seed writes into the database the supervisor created, so it goes through the same guard the
// supervisor and the migration scripts use, with the same `_e2e` requirement: a name that reads as
// disposable is disposable everywhere, and only this run's databases are seeded.
requireDisposableDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL", { ending: "_e2e" });

const [{ db, queryClient }, schema, { encrypt }, { CURRENT_TERMS_VERSION }] = await Promise.all([
  import("../../src/lib/db/index.ts"),
  import("../../src/lib/db/schema/index.ts"),
  import("../../src/lib/settings/crypto.ts"),
  import("../../src/lib/terms.ts"),
]);

/**
 * The seeded rows, written from the declarations the specs assert against.
 *
 * Every account, novel and chapter the run shares is declared in `e2e/fixtures.ts`, together with
 * what each one is for and what a spec may do to it. This script is the second reader of that
 * table - the specs are the first - so the id a spec links to and the row that exists are one
 * declaration rather than two spellings kept in step by hand.
 *
 * Only the prose the app displays is written here: a summary and a chapter's text are what the
 * seed has that a declaration does not, because no spec asserts on either.
 */
const now = new Date();
const dayAgo = new Date(now.getTime() - 86_400_000);

/** Writes one account: the `user` row the app reads, and the credential row it signs in with. */
async function seedAccount(account: SeededAccount): Promise<void> {
  await db.insert(schema.user).values({
    id: account.id,
    name: account.name,
    email: account.email,
    emailVerified: true,
    image: null,
    // The operator role is granted out of band, exactly as a real deployment does it.
    role: account.role,
    // Seeded accounts stand in for real sign-ups, so they record the terms version the
    // create hook would have written: otherwise every scenario shows a re-acceptance
    // notice that no real account would be showing.
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.account).values({
    // One credential row per account, named after it: nothing reads the id back out, so it only
    // has to be unique and recognisable in a query.
    id: `${account.id}-account`,
    accountId: account.id,
    providerId: "credential",
    userId: account.id,
    password: await hashPassword(account.password),
    createdAt: now,
    updatedAt: now,
  });
}

/** What each seeded chapter holds. A declared chapter with no entry here is a seed with a hole. */
const CHAPTER_PROSE: Record<
  string,
  { raw: string; translated?: string; status: "raw" | "translated"; published: boolean }
> = {
  "e2e-member-chapter": { raw: "Raw draft content.", status: "raw", published: false },
  "e2e-target-chapter": { raw: "Raw draft content.", status: "raw", published: false },
  "e2e-reported-chapter": {
    raw: "Published source text for the reporting flow.",
    translated: "Translated text for the reporting flow.",
    status: "translated",
    published: true,
  },
};

/** The one-line summary each seeded novel carries in its header. */
const NOVEL_SUMMARY: Record<string, string> = {
  "e2e-member-novel": "A draft the operator can read and cannot change.",
  "e2e-target-novel": "A draft the operator can read and cannot change.",
  "e2e-reported-novel": "A live novel a member can report and an operator can review.",
};

/**
 * Writes one novel and its chapters.
 *
 * The novel's publication state comes from the declaration, which is also what a spec asserts
 * about it: a novel declared unpublished is one whose chapter the reading page withholds, even
 * from its owner. A missing entry in the prose tables throws rather than writing a row no spec
 * would be able to read.
 */
async function seedNovel(novel: SeededNovel): Promise<void> {
  const summary = NOVEL_SUMMARY[novel.id];
  if (summary === undefined) throw new Error(`The declared novel ${novel.id} has no summary`);
  await db.insert(schema.novels).values({
    id: novel.id,
    userId: readShared(novel.owner).id,
    title: novel.title,
    sourceLang: "en",
    targetLang: "th",
    storySummary: summary,
    publishedAt: novel.published ? dayAgo : null,
    createdAt: now,
    updatedAt: now,
  });

  for (const chapter of novel.chapters) {
    const prose = CHAPTER_PROSE[chapter.id];
    if (prose === undefined) throw new Error(`The declared chapter ${chapter.id} has no prose`);
    await db.insert(schema.chapters).values({
      id: chapter.id,
      novelId: novel.id,
      number: chapter.number,
      title: chapter.title,
      rawContent: prose.raw,
      rawCharCount: prose.raw.length,
      status: prose.status,
      translatedContent: prose.translated ?? null,
      translatedAt: prose.translated === undefined ? null : now,
      publishedAt: prose.published ? dayAgo : null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

for (const account of seededAccounts()) await seedAccount(account);
for (const novel of seededNovels()) await seedNovel(novel);

// The provider every translation spec runs against, pointed at the stub the supervisor starts.
await db.insert(schema.providerSettings).values({
  userId: readShared("admin-account").id,
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
