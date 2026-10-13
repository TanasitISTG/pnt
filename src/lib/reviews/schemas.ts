import { z } from "zod";

/**
 * Review input rules, shared by the novel page's rating widget and the server function
 * that writes it. The database carries the same bounds as check constraints, so a path
 * that skips Zod still cannot store an out-of-range rating or an oversized body.
 */

export const REVIEW_BODY_MAX_LENGTH = 2000;
export const REVIEW_RATING_VALUES = [1, 2, 3, 4, 5] as const;

/** Reviews per page; older ones arrive through "Load more". */
export const REVIEW_PAGE_SIZE = 10;

/** How many reviews one account may write per hour; one per novel is the real guard. */
export const REVIEW_RATE_LIMIT_PER_HOUR = 10;

/** The rating summary beside a novel's title. */
export const novelRatingSchema = z.object({ novelId: z.string().min(1) });

export type NovelRatingInput = z.infer<typeof novelRatingSchema>;

export const listNovelReviewsSchema = z.object({
  novelId: z.string().min(1),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type ListNovelReviewsInput = z.infer<typeof listNovelReviewsSchema>;

/**
 * One review: a rating is required, the words are not. Saving is an upsert, so the same
 * call creates the review or edits the one already there.
 */
export const saveReviewSchema = z.object({
  novelId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(REVIEW_BODY_MAX_LENGTH).optional(),
});

export type SaveReviewInput = z.infer<typeof saveReviewSchema>;

/** Reviews are one per account per novel, so deleting needs only the novel. */
export const deleteReviewSchema = z.object({ novelId: z.string().min(1) });

export type DeleteReviewInput = z.infer<typeof deleteReviewSchema>;

/** The viewer's own review, whether or not it is still live. */
export const myReviewSchema = z.object({ novelId: z.string().min(1) });
