import "@tanstack/react-start/server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels } from "@/lib/db/schema";
import { emptyRelationshipMap, serializeRelationshipMap } from "@/lib/relationships/map";
import { SafeServerError } from "@/lib/server-fn-error";
import { updateNovelSchema, type UpdateNovelInput } from "@/lib/content/novel.schemas";

export async function updateNovelForUser(
  userId: string,
  rawData: UpdateNovelInput,
  coverBuffer?: Uint8Array,
): Promise<{ id: string }> {
  const data = updateNovelSchema.parse(rawData);
  if (data.cover && !coverBuffer) {
    throw new SafeServerError("Cover image data was not validated");
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: novels.id,
        sourceLang: novels.sourceLang,
        targetLang: novels.targetLang,
      })
      .from(novels)
      .where(and(eq(novels.id, data.novelId), eq(novels.userId, userId)))
      .limit(1)
      .for("update");

    if (!existing) {
      throw new SafeServerError("Novel not found or unauthorized");
    }

    const nextSourceLang = data.sourceLang ?? existing.sourceLang;
    const nextTargetLang = data.targetLang ?? existing.targetLang;
    const languagePairChanged =
      nextSourceLang !== existing.sourceLang || nextTargetLang !== existing.targetLang;

    if (languagePairChanged) {
      const [activeChapter] = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.novelId, data.novelId), isNotNull(chapters.activeTranslationJobId)))
        .limit(1);
      if (activeChapter) {
        throw new SafeServerError("Cancel active translations before changing the language pair");
      }
    }

    const updateValues: Record<string, unknown> = {
      title: data.title,
      originalTitle: data.originalTitle,
      author: data.author,
      description: data.description,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
      customPrompt: data.customPrompt,
      updatedAt: new Date(),
    };

    if (languagePairChanged) {
      updateValues.relationshipMapJson = serializeRelationshipMap(emptyRelationshipMap());
    }
    if (data.chunkSize !== undefined) updateValues.chunkSize = data.chunkSize;
    if (data.contextTailLength !== undefined)
      updateValues.contextTailLength = data.contextTailLength;

    if (data.removeCover) {
      updateValues.cover = null;
      updateValues.coverMime = null;
    } else if (coverBuffer) {
      updateValues.cover = coverBuffer;
      updateValues.coverMime = data.coverMime;
    }

    await tx.update(novels).set(updateValues).where(eq(novels.id, data.novelId));
    return { id: data.novelId };
  });
}
