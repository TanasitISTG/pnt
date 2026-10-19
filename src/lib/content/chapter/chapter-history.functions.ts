import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ensureSession, ensureSessionForRead } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  getChapterTranslationVersionForUser,
  listChapterTranslationVersionsForUser,
  restoreChapterTranslationForUser,
} from "./chapter-history.service";

const chapterIdSchema = z.object({ chapterId: z.string().min(1) });
const versionIdSchema = z.object({ versionId: z.string().min(1) });

/**
 * The trail is owner information: it names how the chapter was produced, which models and
 * which glossary pass touched it, and the reader has no business reading any of that. Each
 * function authenticates and the service filters on the novel's `user_id`.
 *
 * The two reads go through `ensureSessionForRead`, so an operator viewing an account can see
 * the same trail the owner sees; the restore is a write and takes the mutation gate.
 */
export const listChapterTranslationVersions = createServerFn({ method: "GET" })
  .validator(chapterIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return listChapterTranslationVersionsForUser(session.user.id, data.chapterId);
    }),
  );

export const getChapterTranslationVersion = createServerFn({ method: "GET" })
  .validator(versionIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return getChapterTranslationVersionForUser(session.user.id, data.versionId);
    }),
  );

export const restoreChapterTranslationVersion = createServerFn({ method: "POST" })
  .validator(versionIdSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return restoreChapterTranslationForUser(session.user.id, data.versionId);
    }),
  );
