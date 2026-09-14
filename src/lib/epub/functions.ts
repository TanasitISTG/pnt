import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels, epubUploads, epubUploadChunks } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth/functions";
import { nanoid } from "@/lib/utils";
import { withSafeHandler, SafeServerError } from "@/lib/server-fn-error";
import { completeEpubImportForUser } from "@/lib/import/commands";

const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB
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

      if (!data.fileName.toLowerCase().endsWith(".epub")) {
        throw new SafeServerError("Only .epub files are supported");
      }

      const expectedChunks = Math.ceil(data.fileSize / CHUNK_SIZE);
      if (data.chunkCount !== expectedChunks) {
        throw new SafeServerError("Invalid chunkCount for fileSize");
      }

      const [novel] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(and(eq(novels.id, data.novelId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!novel) {
        throw new SafeServerError("Novel not found or unauthorized");
      }

      const uploadId = nanoid();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.insert(epubUploads).values({
        id: uploadId,
        novelId: data.novelId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        chunkCount: data.chunkCount,
        receivedBytes: 0,
        status: "uploading",
        expiresAt,
      });

      return { uploadId };
    }),
  );

export const uploadEpubChunk = createServerFn({ method: "POST" })
  .validator(
    z.object({
      uploadId: z.string().min(1),
      chunkIndex: z.number().int().min(0),
      dataBase64: z.string().min(1),
    }),
  )
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();

      const [upload] = await db
        .select({
          id: epubUploads.id,
          fileSize: epubUploads.fileSize,
          chunkCount: epubUploads.chunkCount,
          receivedBytes: epubUploads.receivedBytes,
          status: epubUploads.status,
          expiresAt: epubUploads.expiresAt,
        })
        .from(epubUploads)
        .innerJoin(novels, eq(epubUploads.novelId, novels.id))
        .where(and(eq(epubUploads.id, data.uploadId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (!upload) {
        throw new SafeServerError("Upload not found or unauthorized");
      }
      if (upload.status !== "uploading") {
        throw new SafeServerError("Upload is no longer in uploading state");
      }
      if (upload.expiresAt < new Date()) {
        throw new SafeServerError("Upload session has expired");
      }
      if (data.chunkIndex >= upload.chunkCount) {
        throw new SafeServerError("Chunk index is out of bounds");
      }
      const chunkBuffer = decodeStrictBase64(data.dataBase64);
      const isLastChunk = data.chunkIndex === upload.chunkCount - 1;
      const expectedSize = isLastChunk
        ? upload.fileSize - data.chunkIndex * CHUNK_SIZE
        : CHUNK_SIZE;
      if (chunkBuffer.length !== expectedSize) {
        throw new SafeServerError(
          `Chunk size mismatch: expected ${expectedSize} bytes, got ${chunkBuffer.length} bytes`,
        );
      }

      return await db.transaction(async (tx) => {
        const [lockedUpload] = await tx
          .select({
            id: epubUploads.id,
            fileSize: epubUploads.fileSize,
            chunkCount: epubUploads.chunkCount,
            receivedBytes: epubUploads.receivedBytes,
            status: epubUploads.status,
            expiresAt: epubUploads.expiresAt,
          })
          .from(epubUploads)
          .where(eq(epubUploads.id, data.uploadId))
          .for("update");

        if (!lockedUpload) {
          throw new SafeServerError("Upload not found or unauthorized");
        }
        if (lockedUpload.status !== "uploading") {
          throw new SafeServerError("Upload is no longer in uploading state");
        }
        if (lockedUpload.expiresAt < new Date()) {
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

      const [upload] = await db
        .select({ id: epubUploads.id, status: epubUploads.status })
        .from(epubUploads)
        .innerJoin(novels, eq(epubUploads.novelId, novels.id))
        .where(and(eq(epubUploads.id, data.uploadId), eq(novels.userId, session.user.id)))
        .limit(1);

      if (upload && upload.status === "uploading") {
        await db.delete(epubUploads).where(eq(epubUploads.id, upload.id));
      }

      return { success: true };
    }),
  );
