import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  chapters,
  glossaryTerms,
  novels,
  translationEvalReports,
  translationOutbox,
} from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import {
  EVAL_SELECTOR_ERROR,
  getTranslationEvalReportSchema,
  evalStoredResultSchema,
  evalSummarySchema,
  legacyEvalStoredResultSchema,
  legacyEvalSummarySchema,
  startTranslationEvalSchema,
  type EvalReportDetail,
  type EvalReportSummary,
  type EvalReviewRow,
  type EvalStoredResult,
  type GetTranslationEvalReportInput,
  type LegacyEvalStoredResult,
  type StartTranslationEvalInput,
} from "@/lib/translation/evaluation/eval.schemas";
import { dispatchTranslationOutboxEventBestEffort } from "@/lib/translation/workflow/outbox";
import { nanoid } from "@/lib/utils";

export const EVAL_FAILURE_ERROR = "Quality check failed. Run it again.";

type OutboxDispatch = (outboxId: string) => Promise<void>;
type EvalReportStatus = "pending" | "running" | "done" | "error";

type EvalReportRecord = {
  id: string;
  novelId: string;
  status: EvalReportStatus;
  chapterSelector: string;
  chapterCount: number;
  residualScriptLetters: number;
  markerMismatches: number;
  matchedGlossaryTerms: number;
  adheredGlossaryTerms: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  summaryJson: string | null;
};

type ParsedStoredReport =
  | { kind: "v1"; summary: z.infer<typeof evalSummarySchema>; rows: EvalStoredResult[] }
  | {
      kind: "legacy";
      summary: z.infer<typeof legacyEvalSummarySchema>;
      rows: LegacyEvalStoredResult[];
    };

function parseReportMeta(summaryJson: string | null) {
  if (!summaryJson) return null;
  try {
    const parsed: unknown = JSON.parse(summaryJson);
    const result = evalSummarySchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      languagePair: result.data.languagePair,
      evaluatedChapterCount: result.data.evaluatedChapterCount,
      skippedChapterCount: result.data.skippedChapterCount,
      attentionChapterCount: result.data.attentionChapterCount,
    };
  } catch {
    return null;
  }
}

function toReportSummary(row: EvalReportRecord): EvalReportSummary {
  return {
    id: row.id,
    novelId: row.novelId,
    status: row.status,
    chapterSelector: row.chapterSelector,
    chapterCount: row.chapterCount,
    residualScriptLetters: row.residualScriptLetters,
    markerMismatches: row.markerMismatches,
    matchedGlossaryTerms: row.matchedGlossaryTerms,
    adheredGlossaryTerms: row.adheredGlossaryTerms,
    error: row.status === "error" ? EVAL_FAILURE_ERROR : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    meta: parseReportMeta(row.summaryJson),
  };
}

export function createEvalContextFingerprint(
  sourceLang: string,
  targetLang: string,
  terms: readonly { source: string; target: string }[],
): string {
  const canonicalTerms = terms
    .map((term) => ({ source: term.source, target: term.target }))
    .toSorted((left, right) => {
      if (left.source !== right.source) return left.source < right.source ? -1 : 1;
      if (left.target !== right.target) return left.target < right.target ? -1 : 1;
      return 0;
    });
  return createHash("sha256")
    .update(JSON.stringify({ sourceLang, targetLang, terms: canonicalTerms }), "utf8")
    .digest("hex");
}

export async function queueTranslationEvalForUser(
  userId: string,
  input: StartTranslationEvalInput,
  dispatch: OutboxDispatch = dispatchTranslationOutboxEventBestEffort,
): Promise<{ reportId: string }> {
  const parsed = startTranslationEvalSchema.safeParse(input);
  if (!parsed.success) {
    throw new SafeServerError(parsed.error.issues[0]?.message ?? EVAL_SELECTOR_ERROR);
  }

  const { reportId, outboxId } = await db.transaction(async (tx) => {
    const [novel] = await tx
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.id, parsed.data.novelId), eq(novels.userId, userId)))
      .limit(1);
    if (!novel) throw new SafeServerError("Novel not found");

    const nextReportId = nanoid();
    const nextOutboxId = nanoid();
    await tx.insert(translationEvalReports).values({
      id: nextReportId,
      novelId: parsed.data.novelId,
      status: "pending",
      chapterSelector: parsed.data.chapterSelector,
    });
    await tx.insert(translationOutbox).values({
      id: nextOutboxId,
      eventName: "translation/eval.requested",
      payloadJson: JSON.stringify({ reportId: nextReportId, runKey: nextReportId }),
    });
    return { reportId: nextReportId, outboxId: nextOutboxId };
  });

  await dispatch(outboxId);
  return { reportId };
}

export async function listTranslationEvalReportsForUser(
  userId: string,
  novelId: string,
): Promise<EvalReportSummary[]> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError("Novel not found");

  const rows = await db
    .select({
      id: translationEvalReports.id,
      novelId: translationEvalReports.novelId,
      status: translationEvalReports.status,
      chapterSelector: translationEvalReports.chapterSelector,
      chapterCount: translationEvalReports.chapterCount,
      residualScriptLetters: translationEvalReports.residualScriptLetters,
      markerMismatches: translationEvalReports.markerMismatches,
      matchedGlossaryTerms: translationEvalReports.matchedGlossaryTerms,
      adheredGlossaryTerms: translationEvalReports.adheredGlossaryTerms,
      error: translationEvalReports.error,
      createdAt: translationEvalReports.createdAt,
      updatedAt: translationEvalReports.updatedAt,
      completedAt: translationEvalReports.completedAt,
      summaryJson: translationEvalReports.summaryJson,
    })
    .from(translationEvalReports)
    .innerJoin(novels, eq(translationEvalReports.novelId, novels.id))
    .where(and(eq(translationEvalReports.novelId, novelId), eq(novels.userId, userId)))
    .orderBy(desc(translationEvalReports.createdAt), desc(translationEvalReports.id))
    .limit(10);

  return rows.map(toReportSummary);
}

function parseStoredReport(
  summaryJson: string | null,
  resultsJson: string | null,
): ParsedStoredReport | null {
  if (!summaryJson || !resultsJson) return null;

  try {
    const summaryValue: unknown = JSON.parse(summaryJson);
    const resultsValue: unknown = JSON.parse(resultsJson);
    if (!Array.isArray(resultsValue)) return null;

    const currentSummary = evalSummarySchema.safeParse(summaryValue);
    if (currentSummary.success) {
      const currentRows = z.array(evalStoredResultSchema).safeParse(resultsValue);
      if (!currentRows.success || currentSummary.data.chapterCount !== currentRows.data.length)
        return null;
      const ids = new Set<string>();
      const totals = {
        chapterCount: 0,
        evaluatedChapterCount: 0,
        skippedChapterCount: 0,
        attentionChapterCount: 0,
        residualScriptLetters: 0,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
      };
      for (const row of currentRows.data) {
        if (ids.has(row.chapterId)) return null;
        ids.add(row.chapterId);
        totals.chapterCount++;
        if (row.evaluated) totals.evaluatedChapterCount++;
        else totals.skippedChapterCount++;
        if (hasAttention(row)) totals.attentionChapterCount++;
        totals.residualScriptLetters += row.residualScriptLetters;
        totals.markerMismatches += row.markerMismatches;
        totals.matchedGlossaryTerms += row.matchedGlossaryTerms;
        totals.adheredGlossaryTerms += row.adheredGlossaryTerms;
      }
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        if (totals[key] !== currentSummary.data[key]) return null;
      }
      return { kind: "v1", summary: currentSummary.data, rows: currentRows.data };
    }

    const legacySummary = legacyEvalSummarySchema.safeParse(summaryValue);
    if (!legacySummary.success) return null;
    const legacyRows = z.array(legacyEvalStoredResultSchema).safeParse(resultsValue);
    if (!legacyRows.success || legacySummary.data.chapterCount !== legacyRows.data.length)
      return null;
    return { kind: "legacy", summary: legacySummary.data, rows: legacyRows.data };
  } catch {
    return null;
  }
}

function hasAttention(
  row: Pick<
    EvalReviewRow,
    | "evaluated"
    | "residualScriptLetters"
    | "markerMismatches"
    | "matchedGlossaryTerms"
    | "adheredGlossaryTerms"
  >,
): boolean {
  return (
    row.evaluated !== false &&
    (row.residualScriptLetters > 0 ||
      row.markerMismatches > 0 ||
      row.adheredGlossaryTerms < row.matchedGlossaryTerms)
  );
}

function normalizeLegacyRow(row: LegacyEvalStoredResult): EvalReviewRow {
  return {
    ...row,
    evaluated: null,
    chapterUpdatedAt: null,
    rawParagraphCount: null,
    translatedParagraphCount: null,
    missingGlossaryTerms: null,
    residualSpanCount: null,
    residualExamples: null,
    snapshotState: "unknown",
  };
}

function normalizeCurrentRow(row: EvalStoredResult): EvalReviewRow {
  return { ...row, snapshotState: "unknown" };
}

function sortReviewRows(rows: EvalReviewRow[]): EvalReviewRow[] {
  return rows.toSorted(
    (left, right) =>
      Number(left.chapterNumber) - Number(right.chapterNumber) ||
      left.chapterId.localeCompare(right.chapterId),
  );
}

function canonicalTimestamp(value: Date | string): string | null {
  const date =
    value instanceof Date
      ? value
      : new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function applySnapshotState(
  rows: EvalReviewRow[],
  novelId: string,
  contextChanged: boolean,
): Promise<EvalReviewRow[]> {
  if (rows.length === 0) return rows;

  const currentChapters = await db
    .select({ id: chapters.id, updatedAt: chapters.updatedAt })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        inArray(
          chapters.id,
          rows.map((row) => row.chapterId),
        ),
      ),
    );
  const currentById = new Map(currentChapters.map((chapter) => [chapter.id, chapter.updatedAt]));

  return rows.map((row) => {
    const currentUpdatedAt = currentById.get(row.chapterId);
    if (!currentUpdatedAt) return { ...row, snapshotState: "deleted" };
    if (row.chapterUpdatedAt === null) return row;
    const currentTimestamp = canonicalTimestamp(currentUpdatedAt);
    const snapshotState =
      currentTimestamp === null || currentTimestamp !== row.chapterUpdatedAt
        ? "changed"
        : "current";
    return {
      ...row,
      snapshotState: contextChanged ? "changed" : snapshotState,
    };
  });
}

export async function getTranslationEvalReportForUser(
  userId: string,
  input: GetTranslationEvalReportInput,
): Promise<EvalReportDetail> {
  input = getTranslationEvalReportSchema.parse(input);
  const filter = input.filter;
  const [row] = await db
    .select({
      id: translationEvalReports.id,
      novelId: translationEvalReports.novelId,
      status: translationEvalReports.status,
      chapterSelector: translationEvalReports.chapterSelector,
      chapterCount: translationEvalReports.chapterCount,
      residualScriptLetters: translationEvalReports.residualScriptLetters,
      markerMismatches: translationEvalReports.markerMismatches,
      matchedGlossaryTerms: translationEvalReports.matchedGlossaryTerms,
      adheredGlossaryTerms: translationEvalReports.adheredGlossaryTerms,
      error: translationEvalReports.error,
      createdAt: translationEvalReports.createdAt,
      updatedAt: translationEvalReports.updatedAt,
      completedAt: translationEvalReports.completedAt,
      summaryJson: translationEvalReports.summaryJson,
      resultsJson: translationEvalReports.resultsJson,
      sourceLang: novels.sourceLang,
      targetLang: novels.targetLang,
    })
    .from(translationEvalReports)
    .innerJoin(novels, eq(translationEvalReports.novelId, novels.id))
    .where(
      and(
        eq(translationEvalReports.id, input.reportId),
        eq(translationEvalReports.novelId, input.novelId),
        eq(novels.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new SafeServerError("Quality report not found");

  const report = toReportSummary(row);
  if (
    row.status === "pending" ||
    row.status === "running" ||
    (row.status === "error" && !row.resultsJson)
  ) {
    return {
      report,
      detailsState: "pending",
      rows: [],
      rowCount: 0,
      page: 1,
      pageSize: input.pageSize,
      contextChanged: null,
    };
  }

  const parsed = parseStoredReport(row.summaryJson, row.resultsJson);
  if (
    !parsed ||
    parsed.summary.chapterCount !== report.chapterCount ||
    parsed.summary.residualScriptLetters !== report.residualScriptLetters ||
    parsed.summary.markerMismatches !== report.markerMismatches ||
    parsed.summary.matchedGlossaryTerms !== report.matchedGlossaryTerms ||
    parsed.summary.adheredGlossaryTerms !== report.adheredGlossaryTerms
  ) {
    return {
      report,
      detailsState: "unavailable",
      rows: [],
      rowCount: 0,
      page: 1,
      pageSize: input.pageSize,
      contextChanged: null,
    };
  }

  const normalizedRows = sortReviewRows(
    parsed.kind === "v1"
      ? parsed.rows.map(normalizeCurrentRow)
      : parsed.rows.map(normalizeLegacyRow),
  );
  const filteredRows = normalizedRows.filter((reviewRow) => {
    if (filter === "all") return true;
    if (filter === "untranslated") return reviewRow.evaluated === false;
    return hasAttention(reviewRow);
  });
  const rowCount = filteredRows.length;
  const pageCount = rowCount > 0 ? Math.ceil(rowCount / input.pageSize) : 1;
  const page = Math.min(input.page, pageCount);
  const pageRows = filteredRows.slice((page - 1) * input.pageSize, page * input.pageSize);

  let contextChanged: boolean | null = null;
  if (parsed.kind === "v1") {
    const terms = await db
      .select({ source: glossaryTerms.source, target: glossaryTerms.target })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, row.novelId), eq(glossaryTerms.status, "approved")));
    const currentFingerprint = createEvalContextFingerprint(row.sourceLang, row.targetLang, terms);
    contextChanged = currentFingerprint !== parsed.summary.contextFingerprint;
  }

  const snapshotRows = await applySnapshotState(pageRows, row.novelId, contextChanged === true);

  return {
    report,
    detailsState: "ready",
    rows: snapshotRows,
    rowCount,
    page,
    pageSize: input.pageSize,
    contextChanged,
  };
}
