/**
 * The shapes a chapter discussion takes on the way to a screen.
 *
 * Both the reader's discussion and the operator queue read these fields, so they live in
 * a module importable from the browser. `isOwn` and `viewerReported` are computed on the
 * server from the live session, which is why the client never has to know the viewer's
 * account id to decide which controls a comment offers.
 */

import type { ResolvedAvatar } from "@/lib/profile/types";

export interface CommentAuthor {
  /** Null once the account has been deleted; the comment stays as a tombstone. */
  id: string | null;
  name: string | null;
  avatar: ResolvedAvatar | null;
}

export interface ChapterComment {
  id: string;
  /** Null on a tombstone: the author deleted a comment that has replies. */
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  /** The author's own deletion, rendered as "Comment deleted". */
  deletedAt: Date | null;
  /** An operator's removal, rendered as removed with the reason. */
  removedAt: Date | null;
  removalReason: string | null;
  author: CommentAuthor;
  /** True when the viewer is the author and may still edit or delete it. */
  isOwn: boolean;
  /** True when the viewer already has an open report on this comment. */
  viewerReported: boolean;
}

export interface CommentThread extends ChapterComment {
  /** Newest replies are carried inline; older ones arrive with "Show all replies". */
  replies: ChapterComment[];
  /** Exact number of replies, whether or not all of them are carried. */
  replyCount: number;
  repliesTruncated: boolean;
}

export interface ChapterCommentPage {
  threads: CommentThread[];
  /** Total visible top-level comments, for the section count and paging. */
  rowCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
