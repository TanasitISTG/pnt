import "@tanstack/react-start/server-only";

import { and, count, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { recordAdminAction } from "@/lib/admin/audit.server";
import { resolvePublicCover } from "@/lib/content/novel/cover-storage.server";
import { novelReadable } from "@/lib/content/publish/publish";
import { db } from "@/lib/db";
import { novels, reports, user } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";

import { REPORT_CASE_DETAIL_LIMIT } from "./schemas";
import type { CreateNovelReportInput, ReportQueueInput, ResolveReportCaseInput } from "./schemas";
import type {
  MyNovelReport,
  ReportCase,
  ReportCaseEntry,
  ReportCasePage,
  ReportHistoryPage,
} from "./types";

/**
 * Content reports, from the member who files one to the operator who decides it.
 *
 * Two shapes are worth naming. A *report* is one member's claim. A *case* is the
 * workload an operator actually works: every open report on the same novel, grouped so
 * a single decision covers the pile and the decision is recorded once per report.
 *
 * A case is keyed by the novel id, except once the novel has been deleted - then the
 * report's own id keys it, because there is no novel left to address. Every read of a
 * case goes through `caseKeyOf` so both shapes are one thing to the queue.
 */

/**
 * The grouping key: the novel when there still is one, the report itself otherwise.
 * `novel_id` is cleared rather than cascaded when a novel is deleted, so a case about
 * deleted content outlives it and can still be closed.
 */
const caseKeyOf = sql<string>`coalesce(${reports.novelId}, ${reports.id})`;

/**
 * Postgres hands an aggregate timestamp back as a Date, but a raw `sql` aggregate can
 * arrive as a string depending on the driver's type map; either shape becomes a Date so
 * paging and filtering never compare a string against a timestamp.
 */
function aggregateDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The queue's search term, matched against what an operator can actually see in a row:
 * the novel's current title, the title recorded when it was reported, or the owner's
 * address. Owner matching is what makes "show me everything from this account" work.
 */
function searchFilter(q: string) {
  if (!q) return undefined;
  const term = `%${q}%`;
  return or(
    ilike(novels.title, term),
    ilike(reports.reportedNovelTitle, term),
    exists(
      db
        .select({ match: sql`1` })
        .from(user)
        .where(and(eq(user.id, novels.userId), ilike(user.email, term))),
    ),
  );
}

/**
 * Postgres unique-violation (SQLSTATE 23505), raised by the one-open-report-per-novel
 * index. Drizzle wraps a driver failure in its own error, so the SQLSTATE has to be read
 * off the cause chain; without that the duplicate would surface as a generic failure
 * instead of telling the reporter they already reported this novel.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = current.cause;
  }
  return false;
}

/**
 * Files one report.
 *
 * The novel has to be readable by the reporter - the same live/ownership rule every
 * other read uses, so a draft cannot be reported and does not leak its existence - and
 * it must not be their own: authors report content, they do not report themselves.
 * Filing twice is refused by the index rather than by a read-then-write race.
 */
export async function createNovelReportForUser(
  reporterId: string,
  input: CreateNovelReportInput,
): Promise<{ id: string; novelId: string; createdAt: Date }> {
  const [novel] = await db
    .select({ id: novels.id, userId: novels.userId, title: novels.title })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), novelReadable(reporterId)))
    .limit(1);

  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  if (novel.userId === reporterId) {
    throw new SafeServerError("You cannot report your own novel.");
  }

  const id = nanoid();
  try {
    await db.insert(reports).values({
      id,
      reporterUserId: reporterId,
      targetType: "novel",
      novelId: novel.id,
      reportedNovelTitle: novel.title,
      reportedUserId: novel.userId,
      reason: input.reason,
      details: input.details ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SafeServerError("You already have an open report for this novel.");
    }
    throw error;
  }

  return { id, novelId: novel.id, createdAt: new Date() };
}

/**
 * The reporter's own open report, if there is one. It exists so the novel page can show
 * "Reported" instead of offering a button whose call would fail on the unique index.
 */
export async function getOpenNovelReportForUser(
  reporterId: string,
  novelId: string,
): Promise<MyNovelReport | null> {
  const [row] = await db
    .select({ id: reports.id, status: reports.status, createdAt: reports.createdAt })
    .from(reports)
    .where(
      and(
        eq(reports.reporterUserId, reporterId),
        eq(reports.novelId, novelId),
        eq(reports.status, "open"),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The number of cases still needing a decision, for the operator tab. */
export async function countOpenReportCases(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${caseKeyOf})`.mapWith(Number) })
    .from(reports)
    .where(eq(reports.status, "open"));

  return row?.value ?? 0;
}

/**
 * The open queue, newest work grouped per novel and ordered longest-waiting first: a
 * moderation queue is a queue, and the case that has been open longest is the one whose
 * reporter has been waiting longest.
 *
 * The page is assembled in three reads - the aggregated cases, the novels they point
 * at, and the individual reports - because each wants a different shape: grouping for
 * the counts, exact rows for the novel, and one row per reporter for the case file.
 */
export async function listReportCases(input: ReportQueueInput): Promise<ReportCasePage> {
  const where = and(eq(reports.status, "open"), searchFilter(input.q));

  const [totals, groups] = await Promise.all([
    db
      .select({ value: sql<number>`count(distinct ${caseKeyOf})`.mapWith(Number) })
      .from(reports)
      .leftJoin(novels, eq(novels.id, reports.novelId))
      .where(where),
    db
      .select({
        caseKey: caseKeyOf,
        novelId: reports.novelId,
        titleSnapshot: sql<string | null>`max(${reports.reportedNovelTitle})`,
        openCount: count(),
        firstReportedAt: sql<Date | string>`min(${reports.createdAt})`,
        lastReportedAt: sql<Date | string>`max(${reports.createdAt})`,
        reasons: sql<string[]>`array_agg(distinct ${reports.reason})`,
      })
      .from(reports)
      .leftJoin(novels, eq(novels.id, reports.novelId))
      .where(where)
      // `novel_id` is grouped alongside the key it is folded into because Postgres still
      // requires every selected column to be grouped, even one its key determines.
      .groupBy(caseKeyOf, reports.novelId)
      .orderBy(sql`min(${reports.createdAt})`)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
  ]);

  const caseKeys = groups.map((group) => group.caseKey);
  const novelIds = groups
    .map((group) => group.novelId)
    .filter((novelId): novelId is string => novelId !== null);

  const [novelRows, detailRows] = await Promise.all([
    novelIds.length
      ? db
          .select({
            id: novels.id,
            title: novels.title,
            publishedAt: novels.publishedAt,
            coverKey: novels.coverKey,
            ownerId: novels.userId,
            ownerName: user.name,
            ownerEmail: user.email,
          })
          .from(novels)
          .leftJoin(user, eq(user.id, novels.userId))
          .where(inArray(novels.id, novelIds))
      : Promise.resolve([]),
    caseKeys.length
      ? db
          .select({
            caseKey: caseKeyOf,
            id: reports.id,
            reporterUserId: reports.reporterUserId,
            reporterEmail: user.email,
            reason: reports.reason,
            details: reports.details,
            createdAt: reports.createdAt,
          })
          .from(reports)
          .leftJoin(user, eq(user.id, reports.reporterUserId))
          .where(and(eq(reports.status, "open"), inArray(caseKeyOf, caseKeys)))
          .orderBy(desc(reports.createdAt))
      : Promise.resolve([]),
  ]);

  const novelById = new Map(novelRows.map((row) => [row.id, row]));

  const entriesByCase = new Map<string, ReportCaseEntry[]>();
  for (const row of detailRows) {
    const entries = entriesByCase.get(row.caseKey) ?? [];
    entries.push({
      id: row.id,
      reporterUserId: row.reporterUserId,
      reporterEmail: row.reporterEmail,
      reason: row.reason,
      details: row.details,
      createdAt: row.createdAt,
    });
    entriesByCase.set(row.caseKey, entries);
  }

  const cases: ReportCase[] = groups.map((group) => {
    const novel = group.novelId ? novelById.get(group.novelId) : undefined;
    const cover = novel ? resolvePublicCover(novel.coverKey, novel.publishedAt) : null;
    const allEntries = entriesByCase.get(group.caseKey) ?? [];

    return {
      caseKey: group.caseKey,
      target: {
        novelId: novel?.id ?? null,
        // A deleted novel keeps the title it had when it was reported.
        title: novel?.title ?? group.titleSnapshot ?? "A deleted novel",
        publishedAt: novel?.publishedAt ?? null,
        coverUrl: cover?.url ?? null,
        coverSrcSet: cover?.srcSet ?? null,
        ownerId: novel?.ownerId ?? null,
        ownerName: novel?.ownerName ?? null,
        ownerEmail: novel?.ownerEmail ?? null,
      },
      openCount: group.openCount,
      reasons: group.reasons ?? [],
      firstReportedAt: aggregateDate(group.firstReportedAt),
      lastReportedAt: aggregateDate(group.lastReportedAt),
      entries: allEntries.slice(0, REPORT_CASE_DETAIL_LIMIT),
      truncated: group.openCount > allEntries.length,
    };
  });

  return { cases, rowCount: totals[0]?.value ?? 0, page: input.page, pageSize: input.pageSize };
}

/**
 * Decided cases, newest decision first. A report carries the reporter's words, so this
 * list is itself sensitive: it is only ever read behind `ensureAdminSession`.
 */
export async function listReportHistory(input: ReportQueueInput): Promise<ReportHistoryPage> {
  const where = and(sql`${reports.status} <> 'open'`, searchFilter(input.q));

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: reports.id,
        caseKey: caseKeyOf,
        novelId: reports.novelId,
        novelTitle: sql<string | null>`coalesce(${novels.title}, ${reports.reportedNovelTitle})`,
        reason: reports.reason,
        details: reports.details,
        reporterEmail: user.email,
        status: reports.status,
        resolutionNote: reports.resolutionNote,
        resolvedByEmail: reports.resolvedByEmail,
        resolvedAt: reports.resolvedAt,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .leftJoin(novels, eq(novels.id, reports.novelId))
      .leftJoin(user, eq(user.id, reports.reporterUserId))
      .where(where)
      .orderBy(desc(reports.resolvedAt), desc(reports.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db
      .select({ value: count() })
      .from(reports)
      .leftJoin(novels, eq(novels.id, reports.novelId))
      .where(where),
  ]);

  return { rows, rowCount: totals[0]?.value ?? 0, page: input.page, pageSize: input.pageSize };
}

/**
 * Decides a case: every open report on it moves to the same verdict in one statement, so
 * the pile cannot be half-closed by a retry, and a second operator acting on the same
 * case races to zero rows and is told it was already decided rather than silently
 * rewriting someone else's note.
 *
 * The decision is a note and a status; it never suspends, unpublishes, or deletes
 * anything. Enforcement stays a separate, deliberate operator action.
 */
export async function resolveReportCaseForOperator(
  actor: { id: string; email: string | null },
  input: ResolveReportCaseInput,
): Promise<{ resolvedCount: number; novelId: string | null }> {
  const now = new Date();

  const resolved = await db
    .update(reports)
    .set({
      status: input.decision,
      resolutionNote: input.note ?? null,
      resolvedById: actor.id,
      resolvedByEmail: actor.email,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(reports.status, "open"),
        or(eq(reports.novelId, input.caseKey), eq(reports.id, input.caseKey)),
      ),
    )
    .returning({
      id: reports.id,
      novelId: reports.novelId,
      reportedUserId: reports.reportedUserId,
      reportedNovelTitle: reports.reportedNovelTitle,
    });

  if (resolved.length === 0) {
    throw new SafeServerError("That case has already been decided.");
  }

  const first = resolved[0]!;
  const ownerId = resolved.find((row) => row.reportedUserId)?.reportedUserId ?? null;
  const owner = ownerId
    ? ((
        await db.select({ email: user.email }).from(user).where(eq(user.id, ownerId)).limit(1)
      )[0] ?? null)
    : null;

  await recordAdminAction({
    actorId: actor.id,
    actorEmail: actor.email,
    action: input.decision === "upheld" ? "report.upheld" : "report.dismissed",
    targetUserId: ownerId,
    targetEmail: owner?.email ?? null,
    detail: {
      novelId: first.novelId,
      novelTitle: first.reportedNovelTitle,
      reports: resolved.length,
    },
  });

  return { resolvedCount: resolved.length, novelId: first.novelId };
}
