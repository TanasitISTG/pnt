import { createServerFn } from "@tanstack/react-start";

import { ensureSession, getSession } from "@/lib/auth/functions";
import { checkRateLimit, checkRateLimitForSubject, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { withSafeHandler } from "@/lib/server-fn-error";

import {
  createCommentForUser,
  deleteCommentForUser,
  listChapterCommentsForViewer,
  updateCommentForUser,
} from "./comment.service.server";
import {
  COMMENT_BURST_LIMIT,
  COMMENT_RATE_LIMIT_PER_HOUR,
  createCommentSchema,
  deleteCommentSchema,
  listChapterCommentsSchema,
  updateCommentSchema,
} from "./schemas";

/**
 * Discussion endpoints.
 *
 * The list is public - guests read published chapters and their discussion - so it uses
 * the guest read meter and reads the session only to resolve `isOwn`, `viewerReported`,
 * and an author's own tombstone. Writing is a mutation through `ensureSession`, metered
 * per account on two windows: a daily-ish ceiling and a burst guard, because a
 * discussion reads differently when one person posts three comments a minute.
 */

export const listChapterComments = createServerFn({ method: "GET" })
  .validator(listChapterCommentsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
      return listChapterCommentsForViewer(session?.user.id ?? null, data);
    }),
  );

export const createComment = createServerFn({ method: "POST" })
  .validator(createCommentSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await checkRateLimitForSubject(
        "comment",
        session.user.id,
        COMMENT_RATE_LIMIT_PER_HOUR,
        60 * 60_000,
      );
      await checkRateLimitForSubject("comment-burst", session.user.id, COMMENT_BURST_LIMIT, 60_000);
      return createCommentForUser(session.user.id, data);
    }),
  );

export const updateComment = createServerFn({ method: "POST" })
  .validator(updateCommentSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return updateCommentForUser(session.user.id, data);
    }),
  );

export const deleteComment = createServerFn({ method: "POST" })
  .validator(deleteCommentSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      return deleteCommentForUser(session.user.id, data.commentId);
    }),
  );

export type { ChapterComment, ChapterCommentPage, CommentThread } from "./types";
