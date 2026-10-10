import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { chapters, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";

export type ChapterPublicationInput = {
  chapterId: string;
  publishedAt: Date | null;
};

export type BulkPublicationResult =
  | { id: string; published: number; skipped: number }
  | { id: string; unpublished: number };

function chapterIsReady(chapter: { status: string; translatedContent: string | null }): boolean {
  return chapter.status === "translated" && Boolean(chapter.translatedContent?.trim());
}

export async function setChapterPublishedForUser(
  userId: string,
  input: ChapterPublicationInput,
): Promise<{ id: string }> {
  await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ novelId: chapters.novelId })
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1);
    if (!parent || !(await lockNovelForMutation(tx, parent.novelId, userId))) {
      throw new SafeServerError("Chapter not found or unauthorized");
    }
    const [existing] = await tx
      .select({
        id: chapters.id,
        status: chapters.status,
        translatedContent: chapters.translatedContent,
      })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.novelId, parent.novelId),
          eq(novels.userId, userId),
        ),
      )
      .limit(1)
      .for("update", { of: chapters });

    if (!existing) {
      throw new SafeServerError("Chapter not found or unauthorized");
    }
    if (input.publishedAt !== null && !chapterIsReady(existing)) {
      throw new SafeServerError("Translate the chapter before publishing.");
    }

    await tx
      .update(chapters)
      .set({ publishedAt: input.publishedAt, updatedAt: new Date() })
      .where(eq(chapters.id, input.chapterId));
  });

  return { id: input.chapterId };
}

export async function setAllChaptersPublishedForUser(
  userId: string,
  novelId: string,
  publishedAt: Date | null,
): Promise<BulkPublicationResult> {
  return db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!novel) {
      throw new SafeServerError("Novel not found or unauthorized");
    }

    const chapterRows = await tx
      .select({
        id: chapters.id,
        status: chapters.status,
        translatedContent: chapters.translatedContent,
      })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .for("update");

    if (publishedAt === null) {
      await tx
        .update(chapters)
        .set({ publishedAt: null, updatedAt: new Date() })
        .where(eq(chapters.novelId, novelId));
      return { id: novelId, unpublished: chapterRows.length };
    }

    const readyIds = chapterRows.filter(chapterIsReady).map((chapter) => chapter.id);
    if (readyIds.length > 0) {
      await tx
        .update(chapters)
        .set({ publishedAt, updatedAt: new Date() })
        .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, readyIds)));
    }

    return {
      id: novelId,
      published: readyIds.length,
      skipped: chapterRows.length - readyIds.length,
    };
  });
}
