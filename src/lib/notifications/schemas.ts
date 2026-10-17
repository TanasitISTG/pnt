import { z } from "zod";

/** The novel a follow button or a follow read is about. */
export const notificationNovelSchema = z.object({
  novelId: z.string().min(1),
});

/**
 * Following is a switch, not a toggle request: the client sends the state it wants, so a
 * retried or duplicated request cannot flip the answer to the opposite of what the reader
 * saw. Unfollowing needs no visibility check — a novel that became unreadable must still be
 * leavable.
 */
export const setNovelFollowSchema = z.object({
  novelId: z.string().min(1),
  following: z.boolean(),
});

/**
 * Marking read is either the whole unread set or the ids the reader just looked at. The
 * cap keeps one request from naming a list longer than the bell can show, and omitting it
 * is the one-click "mark all read".
 */
export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(100).optional(),
});

export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;
export type SetNovelFollowInput = z.infer<typeof setNovelFollowSchema>;
