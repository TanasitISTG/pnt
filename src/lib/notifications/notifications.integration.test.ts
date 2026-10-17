import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

/**
 * Follows and the three notification writers, against a real database.
 *
 * The properties that matter are the ones a unit test cannot hold: the author is never a
 * recipient, a second fan-out writes nothing, a scheduled chapter is silent until its time
 * passes, and the row survives the target. Ably is unconfigured here, so every publish is a
 * no-op — which is also the assertion that the rows do not depend on it.
 */

let sql: Sql;
let service: typeof import("./service.server");
let follow: typeof import("./follow.service.server");
let comments: typeof import("@/lib/comments/comment.service.server");
let reports: typeof import("@/lib/reports/report.service.server");
let reviews: typeof import("@/lib/reviews/review.service.server");

let authorId: string;
let aliceId: string;
let bobId: string;
let operatorId: string;
let operatorEmail: string;

let novelId: string;
let chapterLiveId: string;
let chapterScheduledId: string;
let chapterSweepId: string;

const novelTitle = "Followed Fixture";

const timestamp = (value: Date) => sql`${value.toISOString()}::timestamp`;

async function insertUser(id: string, email: string, role: string | null): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "role", "created_at", "updated_at")
    VALUES (${id}, 'Notification Test User', ${email}, true, ${role}, ${timestamp(now)}, ${timestamp(now)})
  `;
}

async function insertNovel(id: string, userId: string, publishedAt: Date | null): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "novels"
      ("id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at")
    VALUES (${id}, ${userId}, ${novelTitle}, 'zh', 'th', ${publishedAt ? timestamp(publishedAt) : null}, ${timestamp(now)}, ${timestamp(now)})
  `;
}

async function insertChapter(
  id: string,
  number: string,
  publishedAt: Date | null,
  title: string,
): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "chapters"
      ("id", "novel_id", "number", "title", "raw_content", "status", "raw_char_count", "published_at", "created_at", "updated_at")
    VALUES (${id}, ${novelId}, ${number}, ${title}, 'raw text', 'translated', 8, ${publishedAt ? timestamp(publishedAt) : null}, ${timestamp(now)}, ${timestamp(now)})
  `;
}

type NotificationRow = {
  kind: string;
  dedupeKey: string;
  novelTitle: string;
  detail: string | null;
};

async function notificationRows(userId: string): Promise<NotificationRow[]> {
  return sql<NotificationRow[]>`
    SELECT "kind", "dedupe_key" AS "dedupeKey", "novel_title" AS "novelTitle", "detail"
    FROM "notifications"
    WHERE "user_id" = ${userId}
    ORDER BY "created_at"
  `;
}

describeIntegration("novel follows and notifications", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 10 }));
    service = await import("./service.server");
    follow = await import("./follow.service.server");
    comments = await import("@/lib/comments/comment.service.server");
    reports = await import("@/lib/reports/report.service.server");
    reviews = await import("@/lib/reviews/review.service.server");

    authorId = `notify-author-${randomUUID()}`;
    aliceId = `notify-alice-${randomUUID()}`;
    bobId = `notify-bob-${randomUUID()}`;
    operatorId = `notify-operator-${randomUUID()}`;
    operatorEmail = `${operatorId}@example.test`;

    await insertUser(authorId, `${authorId}@example.test`, "user");
    await insertUser(aliceId, `${aliceId}@example.test`, "user");
    await insertUser(bobId, `${bobId}@example.test`, "user");
    await insertUser(operatorId, operatorEmail, "admin");

    novelId = `novel-${randomUUID()}`;
    await insertNovel(novelId, authorId, new Date(Date.now() - 3_600_000));

    chapterLiveId = `chapter-live-${randomUUID().slice(0, 8)}`;
    chapterScheduledId = `chapter-scheduled-${randomUUID().slice(0, 8)}`;
    chapterSweepId = `chapter-sweep-${randomUUID().slice(0, 8)}`;

    await insertChapter(chapterLiveId, "1", new Date(Date.now() - 600_000), "Chapter One");
    await insertChapter(chapterScheduledId, "2", new Date(Date.now() + 3_600_000), "Chapter Two");
    await insertChapter(chapterSweepId, "3", new Date(Date.now() - 120_000), "Chapter Three");
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM "admin_audit_log" WHERE "actor_id" = ${operatorId}`;
    await sql`DELETE FROM "novels" WHERE "id" = ${novelId}`;
    await sql`DELETE FROM "user" WHERE "id" IN (${authorId}, ${aliceId}, ${bobId}, ${operatorId})`;
    await closeIntegrationDatabase();
  });

  it("refuses following your own novel and follows someone else's exactly once", async () => {
    await expect(follow.setNovelFollowForUser(authorId, novelId, true)).rejects.toThrow(
      "errors.cannotFollowOwnNovel",
    );
    await expect(follow.setNovelFollowForUser(aliceId, novelId, true)).resolves.toEqual({
      following: true,
    });
    // The same request twice is the same follow, not a second row.
    await expect(follow.setNovelFollowForUser(aliceId, novelId, true)).resolves.toEqual({
      following: true,
    });
    await expect(follow.getNovelFollowForUser(aliceId, novelId)).resolves.toEqual({
      following: true,
    });

    await follow.setNovelFollowForUser(aliceId, novelId, false);
    await expect(follow.getNovelFollowForUser(aliceId, novelId)).resolves.toEqual({
      following: false,
    });

    // Restore the follow for the fan-out cases below, and let the author "follow" their own
    // novel directly so the exclusion is proved rather than inferred from the refusal.
    await follow.setNovelFollowForUser(aliceId, novelId, true);
    await follow.setNovelFollowForUser(bobId, novelId, true);
    await sql`
      INSERT INTO "novel_follows" ("user_id", "novel_id") VALUES (${authorId}, ${novelId})
      ON CONFLICT DO NOTHING
    `;
  });

  it("fans a live chapter out to followers but never its author, exactly once", async () => {
    await expect(service.notifyChapterPublished(chapterLiveId)).resolves.toBe(2);
    await expect(service.notifyChapterPublished(chapterLiveId)).resolves.toBe(0);

    const alice = await notificationRows(aliceId);
    const bob = await notificationRows(bobId);
    const author = await notificationRows(authorId);

    expect(alice).toEqual([
      {
        kind: "chapter_published",
        dedupeKey: `chapter:${chapterLiveId}`,
        novelTitle,
        detail: "Chapter One",
      },
    ]);
    expect(bob).toHaveLength(1);
    expect(author).toHaveLength(0);
  });

  it("stays silent for a scheduled chapter until its time passes", async () => {
    await expect(service.notifyChapterPublished(chapterScheduledId)).resolves.toBe(0);
    await expect(notificationRows(aliceId)).resolves.toHaveLength(1);

    await sql`
      UPDATE "chapters"
      SET "published_at" = ${timestamp(new Date(Date.now() - 1_000))}
      WHERE "id" = ${chapterScheduledId}
    `;
    await expect(service.notifyChapterPublished(chapterScheduledId)).resolves.toBe(2);
  });

  it("clears the rows when a chapter stops being live", async () => {
    await expect(service.clearChapterNotifications(chapterScheduledId)).resolves.toBe(2);
    await expect(notificationRows(aliceId)).resolves.toHaveLength(1);

    // Put it back out of the catalog so the sweep below cannot resurrect it.
    await sql`UPDATE "chapters" SET "published_at" = NULL WHERE "id" = ${chapterScheduledId}`;
  });

  it("tells the novel's owner about a comment on it, once, and never about their own", async () => {
    const comment = await comments.createCommentForUser(aliceId, {
      chapterId: chapterLiveId,
      body: "The magic system is doing a lot of quiet work here.",
    });

    const ownerComment = (await notificationRows(authorId)).filter(
      (row) => row.kind === "novel_comment",
    );
    expect(ownerComment).toHaveLength(1);
    expect(ownerComment[0]).toMatchObject({
      dedupeKey: `novel_comment:${comment.id}`,
      novelTitle,
      detail: "The magic system is doing a lot of quiet work here.",
    });

    // A re-run of the same writer is the same event.
    await expect(service.notifyNovelComment(comment.id)).resolves.toBe(0);

    // The owner commenting on their own novel is not news to themselves.
    await comments.createCommentForUser(authorId, {
      chapterId: chapterLiveId,
      body: "Thank you, that chapter took three passes.",
    });
    expect(
      (await notificationRows(authorId)).filter((row) => row.kind === "novel_comment"),
    ).toHaveLength(1);
  });

  it("tells the novel's owner about a new review once, and not about an edit", async () => {
    const review = await reviews.saveReviewForUser(bobId, {
      novelId,
      rating: 5,
      body: "A patient translation that trusts the reader.",
    });

    const ownerReviews = (await notificationRows(authorId)).filter(
      (row) => row.kind === "novel_review",
    );
    expect(ownerReviews).toHaveLength(1);
    expect(ownerReviews[0]).toMatchObject({
      dedupeKey: `novel_review:${review.id}`,
      novelTitle,
      detail: "A patient translation that trusts the reader.",
    });

    // Editing is not a second review: the same row, the same notification.
    await reviews.saveReviewForUser(bobId, {
      novelId,
      rating: 4,
      body: "On a second read I would still give it five.",
    });
    expect(
      (await notificationRows(authorId)).filter((row) => row.kind === "novel_review"),
    ).toHaveLength(1);
  });

  it("notifies a reply's parent author once, and never the replier", async () => {
    const parent = await comments.createCommentForUser(aliceId, {
      chapterId: chapterLiveId,
      body: "The opening line reads beautifully.",
    });
    const reply = await comments.createCommentForUser(bobId, {
      chapterId: chapterLiveId,
      body: "Agreed, the choice of register is what sells it.",
      parentId: parent.id,
    });

    const alice = await notificationRows(aliceId);
    const replyNotice = alice.filter((row) => row.kind === "comment_reply");
    expect(replyNotice).toHaveLength(1);
    expect(replyNotice[0]).toMatchObject({
      dedupeKey: `comment_reply:${reply.id}`,
      detail: "Agreed, the choice of register is what sells it.",
    });

    // Bob replied to Alice, so Bob hears nothing; a second run writes nothing either.
    expect((await notificationRows(bobId)).every((row) => row.kind !== "comment_reply")).toBe(true);
    await expect(service.notifyCommentReply(reply.id)).resolves.toBe(0);

    // Replying to oneself is not news either.
    const bobTopLevel = await comments.createCommentForUser(bobId, {
      chapterId: chapterLiveId,
      body: "A thought of my own.",
    });
    await comments.createCommentForUser(bobId, {
      chapterId: chapterLiveId,
      body: "Adding to it.",
      parentId: bobTopLevel.id,
    });
    expect((await notificationRows(bobId)).every((row) => row.kind !== "comment_reply")).toBe(true);
  });

  it("tells every reporter once and skips the deciding operator", async () => {
    const aliceReport = await reports.createNovelReportForUser(aliceId, {
      novelId,
      reason: "copyright",
      details: "A repost of a licensed translation.",
    });
    const bobReport = await reports.createNovelReportForUser(bobId, {
      novelId,
      reason: "spam_or_scam",
    });

    await reports.resolveReportCaseForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: novelId, decision: "upheld", note: "Confirmed." },
    );

    const alice = (await notificationRows(aliceId)).filter((row) => row.kind === "report_decided");
    const bob = (await notificationRows(bobId)).filter((row) => row.kind === "report_decided");

    expect(alice).toHaveLength(1);
    expect(bob).toHaveLength(1);
    expect(alice[0]!.dedupeKey).toBe(`report:${aliceReport.id}`);
    expect(bob[0]!.dedupeKey).toBe(`report:${bobReport.id}`);

    const outcomes = await sql<{ outcome: string }[]>`
      SELECT "outcome" FROM "notifications"
      WHERE "kind" = 'report_decided' AND "user_id" IN (${aliceId}, ${bobId})
    `;
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((row) => row.outcome === "upheld")).toBe(true);

    // The operator decided their own view of the case; they are never told about it.
    expect(await notificationRows(operatorId)).toHaveLength(0);
  });

  it("counts unread rows, marks only the caller's own, and can mark them all", async () => {
    const before = await service.listNotificationsForUser(aliceId);
    expect(before.unreadCount).toBe(before.items.length);
    expect(before.items[0]!.createdAt).toEqual(expect.any(String));

    const firstId = before.items[0]!.id;
    const bobBefore = await service.listNotificationsForUser(bobId);
    // Naming another account's notification is inert: the update is scoped by user id.
    await expect(service.markNotificationsReadForUser(bobId, [firstId])).resolves.toEqual({
      unreadCount: bobBefore.unreadCount,
    });
    expect((await service.listNotificationsForUser(aliceId)).unreadCount).toBe(before.unreadCount);

    const after = await service.markNotificationsReadForUser(aliceId, [firstId]);
    expect(after.unreadCount).toBe(before.unreadCount - 1);
    expect((await service.listNotificationsForUser(aliceId)).items[0]!.readAt).not.toBeNull();

    await expect(service.markNotificationsReadForUser(aliceId)).resolves.toEqual({
      unreadCount: 0,
    });
  });

  it("sweeps a chapter that went live without an eager fan-out", async () => {
    const swept = await service.sweepPendingChapterNotifications();
    expect(swept.chapters).toBeGreaterThanOrEqual(1);
    expect(swept.notifications).toBeGreaterThanOrEqual(2);
    expect((await notificationRows(bobId)).some((row) => row.detail === "Chapter Three")).toBe(
      true,
    );

    // Nothing left to do: the dedupe key is what makes the sweep safe to run every two minutes.
    await expect(service.sweepPendingChapterNotifications()).resolves.toEqual({
      chapters: 0,
      notifications: 0,
    });
  });
});
