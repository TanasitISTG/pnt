import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  chapters,
  importJobs,
  novels,
  translationJobChunks,
  translationJobs,
} from "@/lib/db/schema";
import type {
  JobHistoryEpubRow,
  JobHistoryPage,
  JobHistoryRow,
  JobHistoryScrapeRow,
  JobHistorySearch,
  JobHistoryStatus,
  JobHistoryTranslationRow,
} from "@/lib/job-dashboard/contracts";
import { normalizeJobStats } from "@/lib/job-dashboard/contracts";
import type { ScrapeProvider } from "@/lib/scrape/types";
import type { ServerTiming } from "@/lib/server-timing";

type RawJobHistoryRow = {
  id: string;
  type: "translation" | "scrape" | "epub";
  status: JobHistoryStatus;
  novelId: string;
  novelTitle: string;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  chapterId: string | null;
  chapterNumber: string | null;
  chapterTitle: string | null;
  totalChunks: number | null;
  doneChunks: number | null;
  baseUrl: string | null;
  scrapeProvider: string | null;
  sourceFileName: string | null;
  fromNumber: number | null;
  toNumber: number | null;
  nextNumber: number | null;
  added: number | null;
  skipped: number | null;
  failed: number | null;
};
const validScrapeProviders: Record<ScrapeProvider, true> = {
  auto: true,
  direct: true,
  zenrows: true,
  scrapingbee: true,
  firecrawl: true,
};

function normalizeScrapeProvider(value: string | null): ScrapeProvider | null {
  return value && Object.hasOwn(validScrapeProviders, value) ? (value as ScrapeProvider) : null;
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function progress(completed: number, total: number, preparing = false) {
  const safeCompleted = Math.max(0, completed);
  const safeTotal = Math.max(0, total);
  return {
    completed: safeCompleted,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.min(100, Math.round((safeCompleted / safeTotal) * 100)),
    preparing,
  };
}

function baseWhere(
  userId: string,
  status: JobHistorySearch["status"],
  query: string,
  searchable: readonly SQL[],
) {
  const predicates: SQL[] = [eq(novels.userId, userId)];
  if (status !== "all") predicates.push(sql`${translationJobs.status}::text = ${status}`);
  if (query) {
    const searchPredicate = or(...searchable);
    if (searchPredicate) predicates.push(searchPredicate);
  }
  return and(...predicates);
}

function importWhere(
  userId: string,
  status: JobHistorySearch["status"],
  query: string,
  kind: "scrape" | "epub",
  searchable: readonly SQL[],
) {
  const predicates: SQL[] = [eq(novels.userId, userId), eq(importJobs.kind, kind)];
  if (status !== "all") predicates.push(sql`${importJobs.status}::text = ${status}`);
  if (query) {
    const searchPredicate = or(...searchable);
    if (searchPredicate) predicates.push(searchPredicate);
  }
  return and(...predicates);
}

function buildTranslationRows(userId: string, input: JobHistorySearch) {
  const query = `%${escapeIlikePattern(input.q)}%`;
  return db
    .select({
      id: sql<string>`${translationJobs.id}::text`.as("id"),
      type: sql<"translation" | "scrape" | "epub">`'translation'::text`.as("type"),
      status: sql<JobHistoryStatus>`${translationJobs.status}::text`.as("status"),
      novelId: sql<string>`${novels.id}::text`.as("novelId"),
      novelTitle: sql<string>`${novels.title}::text`.as("novelTitle"),
      error: sql<string | null>`${translationJobs.error}::text`.as("error"),
      createdAt: translationJobs.createdAt,
      updatedAt: translationJobs.updatedAt,
      chapterId: sql<string | null>`${chapters.id}::text`.as("chapterId"),
      chapterNumber: sql<string | null>`${chapters.number}::text`.as("chapterNumber"),
      chapterTitle: sql<string | null>`${chapters.title}::text`.as("chapterTitle"),
      totalChunks: sql<number | null>`${translationJobs.totalChunks}::int`.as("totalChunks"),
      doneChunks: sql<number | null>`${translationJobs.doneChunks}::int`.as("doneChunks"),
      baseUrl: sql<string | null>`NULL::text`.as("baseUrl"),
      scrapeProvider: sql<string | null>`NULL::text`.as("scrapeProvider"),
      sourceFileName: sql<string | null>`NULL::text`.as("sourceFileName"),
      fromNumber: sql<number | null>`NULL::int`.as("fromNumber"),
      toNumber: sql<number | null>`NULL::int`.as("toNumber"),
      nextNumber: sql<number | null>`NULL::int`.as("nextNumber"),
      added: sql<number | null>`NULL::int`.as("added"),
      skipped: sql<number | null>`NULL::int`.as("skipped"),
      failed: sql<number | null>`NULL::int`.as("failed"),
    })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      baseWhere(userId, input.status, input.q, [
        ilike(translationJobs.id, query),
        ilike(novels.title, query),
        ilike(chapters.title, query),
        sql`${chapters.number}::text ILIKE ${query}`,
      ]),
    );
}

function buildImportRows(userId: string, input: JobHistorySearch, kind: "scrape" | "epub") {
  const query = `%${escapeIlikePattern(input.q)}%`;
  const type = (
    kind === "scrape"
      ? sql<"translation" | "scrape" | "epub">`'scrape'::text`
      : sql<"translation" | "scrape" | "epub">`'epub'::text`
  ).as("type");
  return db
    .select({
      id: sql<string>`${importJobs.id}::text`.as("id"),
      type,
      status: sql<JobHistoryStatus>`${importJobs.status}::text`.as("status"),
      novelId: sql<string>`${novels.id}::text`.as("novelId"),
      novelTitle: sql<string>`${novels.title}::text`.as("novelTitle"),
      error: sql<string | null>`${importJobs.error}::text`.as("error"),
      createdAt: importJobs.createdAt,
      updatedAt: importJobs.updatedAt,
      chapterId: sql<string | null>`NULL::text`.as("chapterId"),
      chapterNumber: sql<string | null>`NULL::text`.as("chapterNumber"),
      chapterTitle: sql<string | null>`NULL::text`.as("chapterTitle"),
      totalChunks: sql<number | null>`NULL::int`.as("totalChunks"),
      doneChunks: sql<number | null>`NULL::int`.as("doneChunks"),
      baseUrl: sql<string | null>`${importJobs.baseUrl}::text`.as("baseUrl"),
      scrapeProvider:
        kind === "scrape"
          ? sql<string | null>`${importJobs.scrapeProvider}::text`.as("scrapeProvider")
          : sql<string | null>`NULL::text`.as("scrapeProvider"),
      sourceFileName: sql<string | null>`${importJobs.sourceFileName}::text`.as("sourceFileName"),
      fromNumber: sql<number | null>`${importJobs.fromNumber}::int`.as("fromNumber"),
      toNumber: sql<number | null>`${importJobs.toNumber}::int`.as("toNumber"),
      nextNumber: sql<number | null>`${importJobs.nextNumber}::int`.as("nextNumber"),
      added: sql<number | null>`${importJobs.added}::int`.as("added"),
      skipped: sql<number | null>`${importJobs.skipped}::int`.as("skipped"),
      failed: sql<number | null>`${importJobs.failed}::int`.as("failed"),
    })
    .from(importJobs)
    .innerJoin(novels, eq(importJobs.novelId, novels.id))
    .where(
      importWhere(userId, input.status, input.q, kind, [
        ilike(importJobs.id, query),
        ilike(novels.title, query),
        ilike(importJobs.sourceFileName, query),
        ilike(importJobs.baseUrl, query),
      ]),
    );
}

function buildHistoryQuery(userId: string, input: JobHistorySearch) {
  const translationRows = buildTranslationRows(userId, input);
  if (input.type === "translation") return translationRows;

  const scrapeRows = buildImportRows(userId, input, "scrape");
  if (input.type === "scrape") return scrapeRows;

  const epubRows = buildImportRows(userId, input, "epub");
  if (input.type === "epub") return epubRows;

  return unionAll(translationRows, scrapeRows, epubRows);
}

function mapJobHistoryRow(row: RawJobHistoryRow): JobHistoryRow {
  const common = {
    id: row.id,
    status: row.status,
    novelId: row.novelId,
    novelTitle: row.novelTitle,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canCancel: row.status === "pending" || row.status === "running",
  };

  if (row.type === "translation") {
    const totalChunks = Math.max(0, row.totalChunks ?? 0);
    const doneChunks = Math.min(totalChunks, Math.max(0, row.doneChunks ?? 0));
    const translationRow: JobHistoryTranslationRow = {
      ...common,
      type: "translation",
      chapterId: row.chapterId ?? "",
      chapterNumber: row.chapterNumber ?? "",
      chapterTitle: row.chapterTitle ?? "",
      totalChunks,
      doneChunks,
      progress: progress(doneChunks, totalChunks),
      canRetry: row.status === "error" || row.status === "cancelled",
    };
    return translationRow;
  }

  const fromNumber = Math.max(0, row.fromNumber ?? 0);
  const toNumber = Math.max(0, row.toNumber ?? 0);
  const nextNumber = Math.max(0, row.nextNumber ?? 0);
  const added = Math.max(0, row.added ?? 0);
  const skipped = Math.max(0, row.skipped ?? 0);
  const failed = Math.max(0, row.failed ?? 0);
  const provider = normalizeScrapeProvider(row.scrapeProvider);
  const processed = added + skipped + failed;

  if (row.type === "scrape") {
    const scrapeRow: JobHistoryScrapeRow = {
      ...common,
      type: "scrape",
      baseUrl: row.baseUrl ?? "",
      scrapeProvider: provider,
      fromNumber,
      toNumber,
      nextNumber,
      added,
      skipped,
      failed,
      progress: progress(processed, Math.max(0, toNumber - fromNumber + 1)),
      canRetry:
        (row.status === "error" || row.status === "cancelled") &&
        Boolean(row.baseUrl) &&
        provider !== null,
    };
    return scrapeRow;
  }

  const epubRow: JobHistoryEpubRow = {
    ...common,
    type: "epub",
    sourceFileName: row.sourceFileName,
    fromNumber,
    toNumber,
    nextNumber,
    added,
    skipped,
    failed,
    progress: progress(processed, toNumber, toNumber === 0),
    canRetry: false,
  };
  return epubRow;
}

export async function loadJobHistory(
  userId: string,
  input: JobHistorySearch,
  timing: ServerTiming,
): Promise<JobHistoryPage> {
  const historyQuery = buildHistoryQuery(userId, input).as("job_history");
  const [countRow] = await timing.measure("job-history-count", () =>
    db.select({ count: sql<number>`COUNT(*)::int` }).from(historyQuery),
  );
  const rowCount = Number(countRow?.count ?? 0);
  const maxPage = Math.max(1, Math.ceil(rowCount / input.pageSize));
  const page = Math.min(Math.max(input.page, 1), maxPage);
  const sortColumn = {
    updatedAt: historyQuery.updatedAt,
    createdAt: historyQuery.createdAt,
    novelTitle: historyQuery.novelTitle,
    status: historyQuery.status,
    type: historyQuery.type,
  }[input.sort];
  const sortOrder = input.dir === "asc" ? asc : desc;

  const rows = await timing.measure("job-history-rows", () =>
    db
      .select()
      .from(historyQuery)
      .orderBy(
        sortOrder(sortColumn),
        desc(historyQuery.updatedAt),
        asc(historyQuery.type),
        asc(historyQuery.id),
      )
      .limit(input.pageSize)
      .offset((page - 1) * input.pageSize),
  );

  return {
    rows: (rows as RawJobHistoryRow[]).map(mapJobHistoryRow),
    rowCount,
    page,
    pageSize: input.pageSize,
  };
}

export async function loadJobStats(userId: string, timing: ServerTiming) {
  const [translationStats, importStats, chunkStats] = await Promise.all([
    timing.measure("translation-job-stats", () =>
      db
        .select({
          activeJobs: sql<number>`COUNT(*) FILTER (WHERE ${translationJobs.status} IN ('pending', 'running'))::int`,
          failedJobs: sql<number>`COUNT(*) FILTER (WHERE ${translationJobs.status} = 'error')::int`,
        })
        .from(translationJobs)
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(eq(novels.userId, userId)),
    ),
    timing.measure("import-job-stats", () =>
      db
        .select({
          activeJobs: sql<number>`COUNT(*) FILTER (WHERE ${importJobs.status} IN ('pending', 'running'))::int`,
          failedJobs: sql<number>`COUNT(*) FILTER (WHERE ${importJobs.status} = 'error')::int`,
        })
        .from(importJobs)
        .innerJoin(novels, eq(importJobs.novelId, novels.id))
        .where(eq(novels.userId, userId)),
    ),
    timing.measure("chunk-stats", () =>
      db
        .select({
          avgLatencyMs: sql<number>`COALESCE(ROUND(AVG(${translationJobChunks.latencyMs})), 0)::int`,
          promptTokens: sql<number>`COALESCE(SUM(${translationJobChunks.promptTokens}), 0)::int`,
          completionTokens: sql<number>`COALESCE(SUM(${translationJobChunks.completionTokens}), 0)::int`,
        })
        .from(translationJobChunks)
        .innerJoin(translationJobs, eq(translationJobChunks.jobId, translationJobs.id))
        .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
        .innerJoin(novels, eq(chapters.novelId, novels.id))
        .where(eq(novels.userId, userId)),
    ),
  ]);

  return normalizeJobStats(chunkStats[0], translationStats[0], importStats[0]);
}
