import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { novels } from "@/lib/db/schema";
// Mutations authenticate through `ensureSession`. The owner-scoped reads below use
// `ensureSessionForRead`, which still requires an account but does not refuse an
// operator's read-only impersonation session - refusing them would leave the
// operator looking at a broken page instead of the account they asked to view.
import { ensureSession, ensureSessionForRead, getSession } from "@/lib/auth/functions";
import { checkRateLimit, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { createServerTiming } from "@/lib/server-timing";
import { novelReadable } from "@/lib/content/publish/publish";
import { catalogInputSchema } from "@/lib/content/novel/catalog.schemas";
import { listCatalogForViewer } from "@/lib/content/novel/catalog.service.server";
import { resolveAuthorId } from "@/lib/content/novel/author.service.server";
import { listTagsForNovel } from "@/lib/content/novel/tag.service.server";
import type { CatalogNovel } from "@/lib/content/novel/catalog.types";
import {
  createNovelSchema,
  updateNovelSchema,
  setNovelPublishedSchema,
} from "@/lib/content/novel/novel.schemas";
import { deleteNovelForUser, updateNovelForUser } from "@/lib/content/novel/novel-edit.service";
import {
  getAdminNovelDetailCoreForUser,
  getAdminNovelDetailMetricsForUser,
} from "@/lib/content/novel/admin-novel-detail.service";
import {
  deleteCoverSet,
  resolvePublicCover,
  writeCoverSet,
} from "@/lib/content/novel/cover-storage.server";
import { assertImageMagicBytes } from "@/lib/images/magic-bytes";

/**
 * One novel as the directory shows it. The shape lives with the catalog because the same
 * row is returned by the catalog, the shelf, and an author's page; this alias is what the
 * existing card and search modules import.
 */
export type NovelListItem = CatalogNovel;

/**
 * The directory read: both the shared catalog and the account's own shelf.
 *
 * The page is the bound. What used to be "select every published novel and filter in the
 * browser" is now a filtered, ordered, limited query whose `total` describes the filtered
 * set, so the client never holds the table and the payload does not grow with it.
 *
 * The name, method and `novels` server-timing label are kept deliberately: the E2E
 * rate-limit spec discovers this endpoint by that label.
 */
export const listNovels = createServerFn({ method: "GET" })
  .validator(catalogInputSchema)
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => getSession());
        if (!session)
          await timing.measure("rate-limit", () => checkRateLimit("read", GUEST_READ_LIMIT));

        return timing.measure("novels", () => listCatalogForViewer(session?.user.id ?? null, data));
      });
    } finally {
      timing.flush();
    }
  });

export const getNovel = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
      const viewerId = session?.user.id ?? null;

      const [novel] = await db
        .select({
          id: novels.id,
          title: novels.title,
          originalTitle: novels.originalTitle,
          author: novels.author,
          authorId: novels.authorId,
          description: novels.description,
          sourceLang: novels.sourceLang,
          targetLang: novels.targetLang,
          // Owner-only, and evaluated in the database so a reader of someone else's
          // novel never transfers the prompt at all. Nulling it after the fetch left
          // the bytes on the wire.
          customPrompt: sql<string | null>`case
            when ${novels.userId} = ${viewerId} then ${novels.customPrompt}
            else null
          end`,
          chunkSize: novels.chunkSize,
          contextTailLength: novels.contextTailLength,
          publishedAt: novels.publishedAt,
          coverKey: novels.coverKey,
          userId: novels.userId,
          createdAt: novels.createdAt,
          updatedAt: novels.updatedAt,
        })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), novelReadable(viewerId)))
        .limit(1);

      if (!novel) return null;

      const cover = resolvePublicCover(novel.coverKey, novel.publishedAt);
      const { coverKey, userId, ...novelRest } = novel;
      const canManage = session?.user.id === userId;
      // Tags are catalog-visible, so they come with a novel anyone may read; the manage
      // screen edits exactly the list the reader sees.
      const tags = await listTagsForNovel(novel.id);
      return {
        ...novelRest,
        tags,
        sourceLang: novel.sourceLang as "en" | "zh",
        targetLang: novel.targetLang as "en" | "th",
        hasCover: coverKey !== null,
        coverUrl: cover?.url ?? null,
        coverSrcSet: cover?.srcSet ?? null,
        // Every consumer gates its controls on this flag rather than on "is there a
        // session", so an owner-only field can never leak through a control.
        canManage,
      };
    });
  });

export const getReaderNovel = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);

      const [novel] = await db
        .select({
          id: novels.id,
          title: novels.title,
          // The reader route's document head reads this for its description meta; it is
          // not rendered in the reader body.
          description: novels.description,
          sourceLang: novels.sourceLang,
          targetLang: novels.targetLang,
        })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), novelReadable(session?.user.id ?? null)))
        .limit(1);

      return novel ?? null;
    });
  });
export const getAdminNovelDetailCore = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSessionForRead());
        return timing.measure("core", () =>
          getAdminNovelDetailCoreForUser(session.user.id, data.novelId),
        );
      });
    } finally {
      timing.flush();
    }
  });

export const getAdminNovelDetailMetrics = createServerFn({ method: "GET" })
  .validator(z.object({ novelId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const timing = createServerTiming();
    try {
      return await withSafeHandler(async () => {
        const session = await timing.measure("auth", () => ensureSessionForRead());
        return timing.measure("metrics", () =>
          getAdminNovelDetailMetricsForUser(session.user.id, data.novelId),
        );
      });
    } finally {
      timing.flush();
    }
  });

/** Cover-labelled view of the shared upload check, kept for existing callers. */
export function assertCoverMagicBytes(buffer: Uint8Array, mime: string): void {
  assertImageMagicBytes(buffer, mime);
}

export const createNovel = createServerFn({ method: "POST" })
  .validator(createNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const novelId = nanoid();

      const coverBuffer = data.cover ? Buffer.from(data.cover, "base64") : null;
      if (coverBuffer) {
        assertCoverMagicBytes(coverBuffer, data.coverMime ?? "");
      }

      // Objects are written before the row, so a novel never points at a missing
      // cover; if the insert fails the just-written objects are removed again.
      const coverKey = coverBuffer
        ? await writeCoverSet(novelId, coverBuffer, data.coverMime ?? "image/webp")
        : null;
      // The canonical author is resolved before the insert: the upsert is idempotent, and
      // an author row nobody ends up naming is inert.
      const authorId = await resolveAuthorId(data.author);
      try {
        await db.insert(novels).values({
          id: novelId,
          userId: session.user.id,
          title: data.title,
          originalTitle: data.originalTitle,
          author: data.author,
          authorId,
          description: data.description,
          coverKey,
          coverMime: coverKey ? (data.coverMime ?? null) : null,
          sourceLang: data.sourceLang,
          targetLang: data.targetLang,
          customPrompt: data.customPrompt,
          chunkSize: data.chunkSize,
          contextTailLength: data.contextTailLength,
        });
      } catch (error) {
        await deleteCoverSet(coverKey).catch(() => {});
        throw error;
      }

      return { id: novelId };
    });
  });

export const updateNovel = createServerFn({ method: "POST" })
  .validator(updateNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const coverBuffer = data.cover ? Buffer.from(data.cover, "base64") : undefined;
      if (coverBuffer) {
        assertCoverMagicBytes(coverBuffer, data.coverMime ?? "");
      }
      return updateNovelForUser(session.user.id, data, coverBuffer);
    });
  });

export const deleteNovel = createServerFn({ method: "POST" })
  .validator(z.object({ novelId: z.string() }))
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      return deleteNovelForUser(session.user.id, data.novelId);
    });
  });

export const setNovelPublished = createServerFn({ method: "POST" })
  .validator(setNovelPublishedSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();

      const [existing] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!existing) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      const updated = await db
        .update(novels)
        .set({ publishedAt: data.publishedAt, updatedAt: new Date() })
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .returning({ id: novels.id });
      if (updated.length === 0) {
        throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
      }

      return { id: data.novelId };
    });
  });
