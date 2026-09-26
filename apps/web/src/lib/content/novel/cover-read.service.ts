import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { novelLive } from "@/lib/content/publish/publish";
import { NotFoundError } from "@/lib/server-fn-error";

export async function getReadableCover(
  userId: string | null,
  novelId: string,
  requestedWidth?: 320 | 480 | 640,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const [novel] = await db
    .select({ cover: novels.cover, coverMime: novels.coverMime })
    .from(novels)
    .where(
      userId
        ? and(eq(novels.id, novelId), eq(novels.userId, userId))
        : and(eq(novels.id, novelId), novelLive()),
    )
    .limit(1);
  if (!novel?.cover) throw new NotFoundError("Cover not found");
  const bytes = new Uint8Array(novel.cover);
  if (requestedWidth) {
    const { resizeCover } = await import("@/lib/content/novel/cover-image.server");
    return { bytes: await resizeCover(bytes, requestedWidth), mime: "image/webp" };
  }
  return { bytes, mime: novel.coverMime || "image/jpeg" };
}
