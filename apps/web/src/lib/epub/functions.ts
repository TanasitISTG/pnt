import { createServerFn } from "@tanstack/react-start";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, epubUploads, epubUploadChunks, user } from "@/lib/db/schema";
import { lockNovelForMutation } from "@/lib/db/novel-lock";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { completeEpubImportForUser } from "@/lib/import/commands";
import { checkServerFnRateLimitForSubject } from "@/lib/rate-limit";

const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
const MAX_RETAINED_UPLOADS = 2;
const MAX_RESERVED_BYTES = 100 * 1024 * 1024;
const MAX_BASE64_CHUNK_LENGTH = Math.ceil(CHUNK_SIZE / 3) * 4;
const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeStrictBase64(dataBase64: string): Buffer {
  if (dataBase64.length > MAX_BASE64_CHUNK_LENGTH || !STRICT_BASE64_RE.test(dataBase64)) {
    throw new SafeServerError("Chunk data is not valid base64");
  }
  return Buffer.from(dataBase64, "base64");
}

export const createEpubUpload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      novelId: z.string().min(1),
      fileName: z.string().min(1),
      fileSize: z.number().int().min(1).max(MAX_FILE_SIZE),
      chunkCount: z.number().int().min(1),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await checkServerFnRateLimitForSubject("epub-upload-create", session.user.id, 6);

      if (!data.fileName.toLowerCase().endsWith(".epub")) {
        throw new SafeServerError("Only .epub files are supported");
      }

      const expectedChunks = Math.ceil(data.fileSize / CHUNK_SIZE);
      if (data.chunkCount !== expectedChunks) {
        throw new SafeServerError("Invalid chunkCount for fileSize");
      }

      // Account admission precedes the novel gate; no other upload path locks the user.
      return await db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, session.user.id))
          .limit(1)
          .for("update", { of: user });
        if (!owner) throw new SafeServerError("Novel not found or unauthorized");
        if (!(await lockNovelForMutation(tx, data.novelId, session.user.id))) {
          throw new SafeServerError("Novel not found or unauthorized");
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
          throw new SafeServerError("Too many active EPUB uploads");
        }
        if (reservedBytes + data.fileSize > MAX_RESERVED_BYTES) {
          throw new SafeServerError("EPUB upload storage limit reached");
        }

        const uploadId = nanoid();

        await tx.insert(epubUploads).values({
          id: uploadId,
          novelId: data.novelId,
          fileName: data.fileName,
          fileSize: data.fileSize,
          chunkCount: data.chunkCount,
          receivedBytes: 0,
          status: "uploading",
          expiresAt: sql`CURRENT_TIMESTAMP + INTERVAL '24 hours'`,
        });

        return { uploadId };
      });
    }),
  );

export const uploadEpubChunk = createServerFn({ method: "POST" })
  .validator(
    z.object({
      uploadId: z.string().min(1),
      chunkIndex: z.number().int().min(0),
      dataBase64: z.string().min(1).max(MAX_BASE64_CHUNK_LENGTH),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await checkServerFnRateLimitForSubject("epub-upload-chunk", session.user.id, 120);

      const chunkBuffer = decodeStrictBase64(data.dataBase64);

      return await db.transaction(async (tx) => {
        const [upload] = await tx
          .select({ id: epubUploads.id, novelId: epubUploads.novelId })
          .from(epubUploads)
          .innerJoin(novels, eq(epubUploads.novelId, novels.id))
          .where(and(eq(epubUploads.id, data.uploadId), eq(novels.userId, session.user.id)))
          .limit(1);
        if (!upload) {
          throw new SafeServerError("Upload not found or unauthorized");
        }
        if (!(await lockNovelForMutation(tx, upload.novelId, session.user.id))) {
          throw new SafeServerError("Upload not found or unauthorized");
        }

        const [lockedUpload] = await tx
          .select({
            id: epubUploads.id,
            fileSize: epubUploads.fileSize,
            chunkCount: epubUploads.chunkCount,
            receivedBytes: epubUploads.receivedBytes,
            status: epubUploads.status,
            expired: sql<boolean>`${epubUploads.expiresAt} <= CURRENT_TIMESTAMP`,
          })
          .from(epubUploads)
          .where(and(eq(epubUploads.id, data.uploadId), eq(epubUploads.novelId, upload.novelId)))
          .limit(1)
          .for("update");

        if (!lockedUpload) {
          throw new SafeServerError("Upload not found or unauthorized");
        }
        if (lockedUpload.status !== "uploading") {
          throw new SafeServerError("Upload is no longer in uploading state");
        }
        if (lockedUpload.expired) {
          throw new SafeServerError("Upload session has expired");
        }
        if (data.chunkIndex >= lockedUpload.chunkCount) {
          throw new SafeServerError("Chunk index is out of bounds");
        }

        const lockedExpectedSize =
          data.chunkIndex === lockedUpload.chunkCount - 1
            ? lockedUpload.fileSize - data.chunkIndex * CHUNK_SIZE
            : CHUNK_SIZE;
        if (chunkBuffer.length !== lockedExpectedSize) {
          throw new SafeServerError(
            `Chunk size mismatch: expected ${lockedExpectedSize} bytes, got ${chunkBuffer.length} bytes`,
          );
        }

        const inserted = await tx
          .insert(epubUploadChunks)
          .values({
            uploadId: data.uploadId,
            chunkIndex: data.chunkIndex,
            data: chunkBuffer,
          })
          .onConflictDoNothing({
            target: [epubUploadChunks.uploadId, epubUploadChunks.chunkIndex],
          })
          .returning({ chunkIndex: epubUploadChunks.chunkIndex });

        if (inserted.length === 0) {
          return { receivedBytes: lockedUpload.receivedBytes };
        }

        const [updated] = await tx
          .update(epubUploads)
          .set({
            receivedBytes: sql`${epubUploads.receivedBytes} + ${chunkBuffer.length}`,
            updatedAt: new Date(),
          })
          .where(eq(epubUploads.id, data.uploadId))
          .returning({ receivedBytes: epubUploads.receivedBytes });

        return {
          receivedBytes: updated?.receivedBytes ?? lockedUpload.receivedBytes + chunkBuffer.length,
        };
      });
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

      await db.transaction(async (tx) => {
        const [upload] = await tx
          .select({ id: epubUploads.id, novelId: epubUploads.novelId })
          .from(epubUploads)
          .innerJoin(novels, eq(epubUploads.novelId, novels.id))
          .where(and(eq(epubUploads.id, data.uploadId), eq(novels.userId, session.user.id)))
          .limit(1);
        if (!upload) return;
        if (!(await lockNovelForMutation(tx, upload.novelId, session.user.id))) {
          return;
        }
        await tx
          .delete(epubUploads)
          .where(
            and(
              eq(epubUploads.id, upload.id),
              eq(epubUploads.novelId, upload.novelId),
              eq(epubUploads.status, "uploading"),
            ),
          );
      });
      return { success: true };
    }),
  );
