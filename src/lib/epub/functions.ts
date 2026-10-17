import { createServerFn } from "@tanstack/react-start";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { encodeMessage } from "@/lib/i18n/message-code";
import { novels, epubUploads, user } from "@/lib/db/schema";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { completeEpubImportForUser } from "@/lib/import/commands";
import { checkRateLimitForSubject } from "@/lib/rate-limit";
import { getPrivateStorage } from "@/lib/storage/index.server";
import { epubUploadKey, parseObjectKey } from "@/lib/storage/keys";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
const MAX_RETAINED_UPLOADS = 2;
const MAX_RESERVED_BYTES = 100 * 1024 * 1024;
export const EPUB_CONTENT_TYPE = "application/epub+zip";
/** Short-lived write capability: long enough for a 50 MiB upload on a slow link. */
export const EPUB_UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * Reserves an upload slot and returns a presigned URL the browser PUTs the archive
 * to directly. The file never passes through a server function, which is what keeps
 * the 50 MiB limit clear of the platform request-body bound.
 */
export const createEpubUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      novelId: z.string().min(1),
      fileName: z.string().min(1),
      fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await checkRateLimitForSubject("epub-upload-create", session.user.id, 6);

      if (!data.fileName.toLowerCase().endsWith(".epub")) {
        throw new SafeServerError(encodeMessage("errors.epubOnlySupported"));
      }

      const uploadId = nanoid();
      const objectKey = epubUploadKey(uploadId);

      // Account admission precedes the novel gate; no other upload path locks the user.
      await db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, session.user.id))
          .limit(1)
          .for("update", { of: user });
        if (!owner) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
        }

        const [retained] = await tx
          .select({
            slots: sql<number>`count(*)::integer`,
            reservedBytes: sql<string>`coalesce(sum(CASE
              WHEN ${epubUploads.status} IN ('uploading', 'queued') THEN ${epubUploads.fileSize}
              ELSE 0 END), 0)::text`,
          })
          .from(epubUploads)
          .innerJoin(novels, eq(epubUploads.novelId, novels.id))
          .where(
            and(
              eq(novels.userId, session.user.id),
              inArray(epubUploads.status, ["uploading", "queued", "staged"]),
            ),
          );
        const slots = Number(retained?.slots);
        const reservedBytes = Number(retained?.reservedBytes);
        if (
          !Number.isSafeInteger(slots) ||
          slots < 0 ||
          !Number.isSafeInteger(reservedBytes) ||
          reservedBytes < 0
        ) {
          throw new Error("Could not determine upload admission capacity");
        }
        if (slots >= MAX_RETAINED_UPLOADS) {
          throw new SafeServerError(encodeMessage("errors.tooManyEpubUploads"));
        }
        if (reservedBytes + data.fileSize > MAX_RESERVED_BYTES) {
          throw new SafeServerError(encodeMessage("errors.epubStorageLimitReached"));
        }

        await tx.insert(epubUploads).values({
          id: uploadId,
          novelId: data.novelId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          objectKey,
          status: "uploading",
          expiresAt: sql`CURRENT_TIMESTAMP + INTERVAL '24 hours'`,
        });
      });

      // Presigning is local signing only, so it happens after commit: a rejected
      // admission never hands out a write capability.
      const uploadUrl = await getPrivateStorage().presignPut(objectKey, {
        contentType: EPUB_CONTENT_TYPE,
        expiresIn: EPUB_UPLOAD_URL_TTL_SECONDS,
      });

      return { uploadId, uploadUrl };
    }),
  );

export const completeEpubUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      uploadId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return completeEpubImportForUser(session.user.id, data.uploadId);
    }),
  );

export const abortEpubUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      uploadId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const objectKey = await db.transaction(async (tx) => {
        const [upload] = await tx
          .select({
            id: epubUploads.id,
            novelId: epubUploads.novelId,
            objectKey: epubUploads.objectKey,
          })
          .from(epubUploads)
          .innerJoin(novels, eq(epubUploads.novelId, novels.id))
          .where(and(eq(epubUploads.id, data.uploadId), eq(novels.userId, session.user.id)))
          .limit(1);
        if (!upload) return null;
        if (!(await lockNovelForMutation(tx, upload.novelId, session.user.id))) {
          return null;
        }
        const deleted = await tx
          .delete(epubUploads)
          .where(
            and(
              eq(epubUploads.id, upload.id),
              eq(epubUploads.novelId, upload.novelId),
              eq(epubUploads.status, "uploading"),
            ),
          )
          .returning({ id: epubUploads.id });
        return deleted.length > 0 ? upload.objectKey : null;
      });

      // The staged archive is unreachable once its row is gone. The value comes from the row this
      // transaction just deleted, so it is read back before it reaches the bucket.
      if (objectKey) {
        const stored = parseObjectKey(objectKey);
        if (stored)
          await getPrivateStorage()
            .delete(stored.key)
            .catch(() => {});
      }
      return { success: true };
    }),
  );
