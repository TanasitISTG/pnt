// Shared types for follows and in-app notifications. Leaf module — types only.

export type NotificationKind =
  | "chapter_published"
  | "comment_reply"
  | "novel_comment"
  | "novel_review"
  | "report_decided";

export type ReportOutcome = "upheld" | "dismissed";

/**
 * One notification as the bell reads it. Every target is nullable because the row outlives
 * what it names: a deleted chapter leaves the sentence and clears the link, which is why
 * `novelTitle` and `detail` are snapshots rather than joins.
 */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  novelId: string | null;
  chapterId: string | null;
  commentId: string | null;
  reportId: string | null;
  novelTitle: string;
  /** The chapter the notification points at, read live so a renamed chapter stays current. */
  chapterTitle: string | null;
  /** Chapter title for a published chapter, the reply's words for a reply, null otherwise. */
  detail: string | null;
  outcome: ReportOutcome | null;
  /** ISO text, matching the reader-state convention for transport. */
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  unreadCount: number;
}

export interface NovelFollowState {
  following: boolean;
}

/** How many rows the bell reads; anything older is pruned rather than paged for now. */
export const NOTIFICATION_LIST_SIZE = 20;

/** The reply excerpt stored on a notification stays short enough to read in one line. */
export const NOTIFICATION_EXCERPT_MAX_LENGTH = 160;
