/**
 * The shapes a novel review takes on the way to a screen.
 *
 * The reader's novel page and the operator queue both read them, so they live in a
 * module importable from the browser. `isOwn` and `viewerReported` are computed on the
 * server from the live session, the same split the comments payload uses.
 */

import type { ResolvedAvatar } from "@/lib/profile/types";

export interface ReviewAuthor {
  id: string | null;
  name: string | null;
  avatar: ResolvedAvatar | null;
}

export interface NovelReview {
  id: string;
  rating: number;
  /** Optional by design: rating takes one tap and writing is an invitation. */
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  /** Only ever set on the viewer's own review; removed reviews are invisible otherwise. */
  removedAt: Date | null;
  removalReason: string | null;
  author: ReviewAuthor;
  isOwn: boolean;
  viewerReported: boolean;
}

export interface NovelRatingSummary {
  /** Null until the first review: a novel with no ratings shows no score at all. */
  average: number | null;
  count: number;
  /** Five rows, 5 down to 1, so the bars can be drawn without re-sorting. */
  distribution: { rating: number; count: number }[];
}

export interface NovelReviewPage {
  reviews: NovelReview[];
  rowCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
