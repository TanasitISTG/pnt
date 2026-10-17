// The one spelling of the realtime vocabulary, shared by the server that publishes and the
// browser that listens. Leaf module — no server import may leak into this file.

/** One channel per account, so a token can grant exactly one subscription. */
export const NOTIFICATION_CHANNEL_PREFIX = "notifications:";

/** The Ably event name a notification is published under. */
export const NOTIFICATION_MESSAGE_NAME = "notification";

export function notificationChannel(userId: string): string {
  return `${NOTIFICATION_CHANNEL_PREFIX}${userId}`;
}

/**
 * What travels over the socket. It is a hint, not the record: the client refetches the row
 * it names (`id`) and renders from that, so a stale or duplicated message changes nothing.
 */
export interface NotificationMessage {
  /** The recipient, used only to pick the channel. */
  userId: string;
  id: string;
  kind: "chapter_published" | "comment_reply" | "novel_comment" | "novel_review" | "report_decided";
  novelId: string | null;
  chapterId: string | null;
  commentId: string | null;
  reportId: string | null;
  novelTitle: string;
  detail: string | null;
  outcome: "upheld" | "dismissed" | null;
  /** ISO text, because the socket carries JSON and not a Date. */
  createdAt: string;
}
