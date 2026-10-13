import { z } from "zod";

/**
 * Comment input rules, shared by the reader's composer and the server function that
 * writes it. The database check constraint carries the same 2000-character bound, so a
 * path that skips Zod still cannot store an oversized body.
 */

export const COMMENT_BODY_MAX_LENGTH = 2000;

/** Top-level comments per page; older pages arrive through "Load more". */
export const COMMENT_PAGE_SIZE = 20;

/** Replies carried inline with a thread; the rest wait behind "Show all replies". */
export const COMMENT_VISIBLE_REPLIES = 3;

/** Hard per-thread cap on replies fetched in one page, so one thread cannot stampede. */
export const COMMENT_REPLY_FETCH_LIMIT = 25;

/**
 * How many comments one account may post per hour, plus a burst guard. Well above what a
 * reader needs and below what a script can use to flood a chapter.
 */
export const COMMENT_RATE_LIMIT_PER_HOUR = 20;
export const COMMENT_BURST_LIMIT = 3;

/** One page of a chapter's discussion. */
export const listChapterCommentsSchema = z.object({
  chapterId: z.string().min(1),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type ListChapterCommentsInput = z.infer<typeof listChapterCommentsSchema>;

export const createCommentSchema = z.object({
  chapterId: z.string().min(1),
  /** Present for a reply; the parent must itself be a top-level comment. */
  parentId: z.string().min(1).optional(),
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  commentId: z.string().min(1),
  body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
});

export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const deleteCommentSchema = z.object({ commentId: z.string().min(1) });

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;
