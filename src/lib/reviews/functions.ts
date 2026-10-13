import { createServerFn } from "@tanstack/react-start";

import { ensureSession, ensureSessionForRead, getSession } from "@/lib/auth/functions";
import { checkRateLimit, checkRateLimitForSubject, GUEST_READ_LIMIT } from "@/lib/rate-limit";
import { withSafeHandler } from "@/lib/server-fn-error";

import {
  deleteReviewForUser,
  getMyReviewForUser,
  getNovelRatingForViewer,
  listNovelReviewsForViewer,
  saveReviewForUser,
} from "./review.service.server";
import {
  deleteReviewSchema,
  listNovelReviewsSchema,
  myReviewSchema,
  novelRatingSchema,
  REVIEW_RATE_LIMIT_PER_HOUR,
  saveReviewSchema,
} from "./schemas";

/**
 * Review endpoints.
 *
 * The summary and the list are public reads - guests read published novels and their
 * reviews - so they use the guest read meter. Writing is a mutation through
 * `ensureSession`, metered per account; one review per novel is enforced by the partial
 * unique index rather than by the meter.
 */

export const getNovelRating = createServerFn({ method: "GET" })
  .validator(novelRatingSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
      return getNovelRatingForViewer(session?.user.id ?? null, data.novelId);
    }),
  );

export const listNovelReviews = createServerFn({ method: "GET" })
  .validator(listNovelReviewsSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await getSession();
      if (!session) await checkRateLimit("read", GUEST_READ_LIMIT);
      return listNovelReviewsForViewer(session?.user.id ?? null, data);
    }),
  );

/**
 * The viewer's own review. A read, so it uses `ensureSessionForRead` and keeps working
 * while an operator views an account; writing below still refuses an impersonated session.
 */
export const getMyReview = createServerFn({ method: "GET" })
  .validator(myReviewSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSessionForRead();
      return { review: await getMyReviewForUser(session.user.id, data.novelId) };
    }),
  );

export const saveReview = createServerFn({ method: "POST" })
  .validator(saveReviewSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      await checkRateLimitForSubject(
        "review",
        session.user.id,
        REVIEW_RATE_LIMIT_PER_HOUR,
        60 * 60_000,
      );
      return saveReviewForUser(session.user.id, data);
    }),
  );

export const deleteReview = createServerFn({ method: "POST" })
  .validator(deleteReviewSchema)
  .handler(async ({ data }) =>
    withSafeHandler(async () => {
      const session = await ensureSession();
      const deleted = await deleteReviewForUser(session.user.id, data.novelId);
      return { deleted };
    }),
  );

export type { NovelRatingSummary, NovelReview, NovelReviewPage, ReviewAuthor } from "./types";
