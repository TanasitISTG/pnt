import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

/**
 * What the history trail promises once it is a database table rather than an in-memory list.
 *
 * The properties are the ones the old single-column chapter could not have: every write path
 * leaves a row (so the newest row is always the current text), restoring is itself a row
 * (so it is undoable), the trail is capped rather than unbounded, and a second account can
 * neither read nor restore someone else's versions.
 */

let sql: Sql;
let updateChapterForUser: typeof import("./chapter-edit.service").updateChapterForUser;
let listVersions: typeof import("./chapter-history.service").listChapterTranslationVersionsForUser;
let getVersion: typeof import("./chapter-history.service").getChapterTranslationVersionForUser;
let restoreVersion: typeof import("./chapter-history.service").restoreChapterTranslationForUser;
let deleteAllTranslations: typeof import("./chapter-ops.service").deleteAllNovelTranslationsForUser;
let getNovelDetailCore: typeof import("@/lib/content/novel/admin-novel-detail.service").getAdminNovelDetailCoreForUser;
let completeJob: typeof import("@/lib/translation/workflow/job-store").completeJob;
let updateGlossaryTermAtomic: typeof import("@/lib/glossary/service").updateGlossaryTermAtomic;

const DISPATCH = async () => {};

interface Fixture {
  ownerId: string;
  otherUserId: string;
  novelId: string;
  chapterId: string;
}

async function seedChapter(content = "Original translation."): Promise<Fixture> {
  const ownerId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterId = `chapter-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerId}, 'History Owner', ${`${ownerId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Reader', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${novelId}, ${ownerId}, 'History Fixture', 'en', 'th', now(), now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
      "raw_char_count", "source_revision", "translation_generation", "created_at", "updated_at"
    ) VALUES (
      ${chapterId}, ${novelId}, 1, 'Chapter One', 'Raw text.', ${content}, 'translated',
      9, 1, 2, now(), now()
    )
  `;
  return { ownerId, otherUserId, novelId, chapterId };
}

async function chapterState(chapterId: string) {
  const [row] = await sql<
    { translatedContent: string | null; translatedTitle: string | null; editedAt: Date | null }[]
  >`
    SELECT
      "translated_content" AS "translatedContent",
      "translated_title" AS "translatedTitle",
      "edited_at" AS "editedAt"
    FROM "chapters" WHERE "id" = ${chapterId}
  `;
  return row;
}

async function cleanup(fixture: Fixture) {
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerId}, ${fixture.otherUserId})`;
}

describeIntegration("chapter translation history PostgreSQL contracts", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url));
    ({ updateChapterForUser } = await import("./chapter-edit.service"));
    ({ listChapterTranslationVersionsForUser: listVersions } =
      await import("./chapter-history.service"));
    ({ getChapterTranslationVersionForUser: getVersion } =
      await import("./chapter-history.service"));
    ({ restoreChapterTranslationForUser: restoreVersion } =
      await import("./chapter-history.service"));
    ({ deleteAllNovelTranslationsForUser: deleteAllTranslations } =
      await import("./chapter-ops.service"));
    ({ getAdminNovelDetailCoreForUser: getNovelDetailCore } =
      await import("@/lib/content/novel/admin-novel-detail.service"));
    ({ completeJob } = await import("@/lib/translation/workflow/job-store"));
    ({ updateGlossaryTermAtomic } = await import("@/lib/glossary/service"));
  });

  afterAll(closeIntegrationDatabase);

  it("records a manual edit and restores an earlier generation as a new version", async () => {
    const fixture = await seedChapter();
    try {
      await updateChapterForUser(
        fixture.ownerId,
        { chapterId: fixture.chapterId, translatedContent: "Second translation." },
        DISPATCH,
      );
      await updateChapterForUser(
        fixture.ownerId,
        { chapterId: fixture.chapterId, translatedContent: "Third translation." },
        DISPATCH,
      );

      const versions = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(versions).toHaveLength(2);
      expect(versions[0].origin).toBe("manual");

      const second = await getVersion(fixture.ownerId, versions[1].id);
      expect(second.content).toBe("Second translation.");

      const restored = await restoreVersion(fixture.ownerId, versions[1].id);
      expect(restored.chapterId).toBe(fixture.chapterId);
      expect((await chapterState(fixture.chapterId))?.translatedContent).toBe(
        "Second translation.",
      );

      const after = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(after).toHaveLength(3);
      expect(after[0].origin).toBe("rollback");
      expect((await getVersion(fixture.ownerId, after[0].id)).content).toBe("Second translation.");

      // Restoring the text the chapter already holds is not a new version.
      await restoreVersion(fixture.ownerId, after[0].id);
      expect(await listVersions(fixture.ownerId, fixture.chapterId)).toHaveLength(3);
    } finally {
      await cleanup(fixture);
    }
  });

  it("keeps the trail, and the chapter-list signal, after a bulk delete clears the translations", async () => {
    const fixture = await seedChapter();
    try {
      await updateChapterForUser(
        fixture.ownerId,
        { chapterId: fixture.chapterId, translatedContent: "Text before the delete." },
        DISPATCH,
      );
      const [version] = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(version).toBeTruthy();

      const cleared = await deleteAllTranslations(fixture.ownerId, fixture.novelId, DISPATCH);
      expect(cleared.chaptersCleared).toBe(1);
      expect((await chapterState(fixture.chapterId))?.translatedContent).toBeNull();

      // The list row has to say the trail is still there: a chapter with no translation at
      // all is exactly the row whose history action would otherwise disappear.
      const core = await getNovelDetailCore(fixture.ownerId, fixture.novelId);
      expect(core?.chapters[0]).toMatchObject({ hasTranslation: false, hasHistory: true });

      // Clearing writes no version of its own — the trail is what it was before the delete —
      // and restoring from it is still the ordinary write.
      expect(await listVersions(fixture.ownerId, fixture.chapterId)).toHaveLength(1);
      await restoreVersion(fixture.ownerId, version.id);
      expect((await chapterState(fixture.chapterId))?.translatedContent).toBe(
        "Text before the delete.",
      );
      expect(await listVersions(fixture.ownerId, fixture.chapterId)).toHaveLength(2);
    } finally {
      await cleanup(fixture);
    }
  });

  it("keeps the newest twenty versions and prunes the rest", async () => {
    const fixture = await seedChapter();
    try {
      for (let index = 1; index <= 25; index++) {
        await updateChapterForUser(
          fixture.ownerId,
          { chapterId: fixture.chapterId, translatedContent: `Revision ${index}.` },
          DISPATCH,
        );
      }
      const versions = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(versions).toHaveLength(20);
      expect((await getVersion(fixture.ownerId, versions[0].id)).content).toBe("Revision 25.");
      expect((await getVersion(fixture.ownerId, versions[19].id)).content).toBe("Revision 6.");
    } finally {
      await cleanup(fixture);
    }
  });

  it("records a finished translation run and the job that produced it", async () => {
    const fixture = await seedChapter();
    const jobId = `job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation", "total_chunks",
          "done_chunks", "created_at", "updated_at"
        ) VALUES (${jobId}, ${fixture.chapterId}, 'running', 1, 3, 1, 1, now(), now())
      `;
      await sql`
        INSERT INTO "translation_job_chunks" ("job_id", "chunk_index", "source_text", "text_length")
        VALUES (${jobId}, 0, 'Raw text.', 9)
      `;
      await sql`
        UPDATE "chapters"
        SET "status" = 'translating', "active_translation_job_id" = ${jobId},
            "translation_generation" = 3
        WHERE "id" = ${fixture.chapterId}
      `;

      const completed = await completeJob({
        jobId,
        generation: 3,
        fullTranslation: "Translation from the run.",
        translatedTitle: "Chapter One, translated",
        chapterSummary: "They arrive.",
        glossaryRows: [],
        logsJson: "[]",
        usageJson: "{}",
      });
      expect(completed).toBe(true);

      const versions = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        origin: "translation",
        generation: 3,
        translatedTitle: "Chapter One, translated",
      });
      expect((await getVersion(fixture.ownerId, versions[0].id)).content).toBe(
        "Translation from the run.",
      );
    } finally {
      await cleanup(fixture);
    }
  });

  it("records the chapter a glossary propagation rewrites", async () => {
    const fixture = await seedChapter("The old name speaks. The old name again.");
    const termId = `term-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "glossary_terms" (
          "id", "novel_id", "source", "target", "category", "status", "created_at", "updated_at"
        ) VALUES (${termId}, ${fixture.novelId}, 'Old Name', 'old name', 'character', 'approved', now(), now())
      `;

      await updateGlossaryTermAtomic(
        fixture.ownerId,
        { termId, target: "new name", applyToChapters: true },
        DISPATCH,
      );

      expect((await chapterState(fixture.chapterId))?.translatedContent).toBe(
        "The new name speaks. The new name again.",
      );
      const versions = await listVersions(fixture.ownerId, fixture.chapterId);
      expect(versions[0].origin).toBe("glossary");
      expect((await getVersion(fixture.ownerId, versions[0].id)).content).toBe(
        "The new name speaks. The new name again.",
      );
    } finally {
      await cleanup(fixture);
    }
  });

  it("refuses to restore while a translation owns the chapter", async () => {
    const fixture = await seedChapter();
    try {
      await updateChapterForUser(
        fixture.ownerId,
        { chapterId: fixture.chapterId, translatedContent: "Edited once." },
        DISPATCH,
      );
      const [version] = await listVersions(fixture.ownerId, fixture.chapterId);
      await sql`
        UPDATE "chapters" SET "active_translation_job_id" = 'job-running'
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(restoreVersion(fixture.ownerId, version.id)).rejects.toMatchObject({
        message: "errors.chapterTranslationActive",
      });
    } finally {
      await cleanup(fixture);
    }
  });

  it("keeps a chapter's history to its owner", async () => {
    const fixture = await seedChapter();
    try {
      await updateChapterForUser(
        fixture.ownerId,
        { chapterId: fixture.chapterId, translatedContent: "Only the owner's." },
        DISPATCH,
      );
      const [version] = await listVersions(fixture.ownerId, fixture.chapterId);

      await expect(listVersions(fixture.otherUserId, fixture.chapterId)).rejects.toMatchObject({
        message: "errors.chapterNotFoundOrUnauthorized",
      });
      await expect(getVersion(fixture.otherUserId, version.id)).rejects.toMatchObject({
        message: "errors.translationVersionNotFoundOrUnauthorized",
      });
      await expect(restoreVersion(fixture.otherUserId, version.id)).rejects.toMatchObject({
        message: "errors.translationVersionNotFoundOrUnauthorized",
      });
    } finally {
      await cleanup(fixture);
    }
  });
});
