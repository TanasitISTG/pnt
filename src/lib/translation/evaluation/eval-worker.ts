import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, queryClient } from "@/lib/db";
import { glossaryTerms, novels, translationEvalReports } from "@/lib/db/schema";
import { log } from "@/lib/log";
import {
  parseEvalSelection,
  type EvalSelection,
  type EvalStoredResult,
} from "@/lib/translation/evaluation/eval.schemas";
import {
  createEvalContextFingerprint,
  EVAL_FAILURE_ERROR,
} from "@/lib/translation/evaluation/eval.service";
import { splitParagraphs } from "@/lib/translation/text/paragraphs";
import { scanResidualScripts } from "@/lib/translation/text/residual";

const REPORT_STATUSES_IN_PROGRESS = ["pending", "running"] as const;
const CURSOR_BATCH_SIZE = 25;
const RESIDUAL_EXAMPLE_LIMIT = 120;
const RESIDUAL_EXAMPLE_COUNT = 3;

type EvalChapterCursorRow = {
  id: string;
  number: string;
  title: string;
  status: EvalStoredResult["status"];
  rawContent: string;
  translatedContent: string | null;
  updatedAt: string;
};

type ApprovedTerm = { source: string; target: string };

type EvalAggregate = {
  chapterCount: number;
  residualScriptLetters: number;
  markerMismatches: number;
  matchedGlossaryTerms: number;
  adheredGlossaryTerms: number;
  evaluatedChapterCount: number;
  skippedChapterCount: number;
  attentionChapterCount: number;
};

function canonicalTimestamp(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Invalid chapter timestamp");
  return timestamp.toISOString();
}

function containsLiteralText(text: string, candidate: string): boolean {
  if (candidate.length === 0) return true;
  return text.includes(candidate);
}

function truncateUnicode(value: string): string {
  let offset = 0;
  let count = 0;
  for (const char of value) {
    if (++count === RESIDUAL_EXAMPLE_LIMIT) {
      return offset + char.length === value.length ? value : `${value.slice(0, offset)}…`;
    }
    offset += char.length;
  }
  return value;
}

function compareTerms(left: ApprovedTerm, right: ApprovedTerm): number {
  return left.source < right.source
    ? -1
    : left.source > right.source
      ? 1
      : left.target < right.target
        ? -1
        : left.target > right.target
          ? 1
          : 0;
}

function createEvalResult(
  chapter: EvalChapterCursorRow,
  languagePair: string,
  protectedTerms: readonly string[],
  approvedTerms: readonly ApprovedTerm[],
): EvalStoredResult {
  const translatedText = chapter.translatedContent;
  const evaluated = translatedText !== null && translatedText.trim().length > 0;
  const rawParagraphCount = splitParagraphs(chapter.rawContent).length;
  const translatedParagraphCount = evaluated ? splitParagraphs(translatedText).length : 0;

  if (!evaluated) {
    return {
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      status: chapter.status,
      residualScriptLetters: 0,
      markerMismatches: 0,
      matchedGlossaryTerms: 0,
      adheredGlossaryTerms: 0,
      glossaryAdherencePercent: null,
      evaluated: false,
      chapterUpdatedAt: canonicalTimestamp(chapter.updatedAt),
      rawParagraphCount,
      translatedParagraphCount,
      missingGlossaryTerms: [],
      residualSpanCount: 0,
      residualExamples: [],
    };
  }

  const residual = scanResidualScripts(languagePair, translatedText, {
    sourceText: chapter.rawContent,
    protectedTerms,
  });
  let matchedTerms = 0;
  let adheredTerms = 0;
  const missingTerms: ApprovedTerm[] = [];
  for (const term of approvedTerms) {
    if (!containsLiteralText(chapter.rawContent, term.source)) continue;
    matchedTerms++;
    if (containsLiteralText(translatedText, term.target)) adheredTerms++;
    else if (missingTerms.length < 5) missingTerms.push(term);
  }

  return {
    chapterId: chapter.id,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    status: chapter.status,
    residualScriptLetters: residual.letterCount,
    markerMismatches: Math.abs(rawParagraphCount - translatedParagraphCount),
    matchedGlossaryTerms: matchedTerms,
    adheredGlossaryTerms: adheredTerms,
    glossaryAdherencePercent:
      matchedTerms > 0 ? Math.round((adheredTerms / matchedTerms) * 100) : null,
    evaluated: true,
    chapterUpdatedAt: canonicalTimestamp(chapter.updatedAt),
    rawParagraphCount,
    translatedParagraphCount,
    missingGlossaryTerms: missingTerms,
    residualSpanCount: residual.spans.length,
    residualExamples: residual.spans
      .slice(0, RESIDUAL_EXAMPLE_COUNT)
      .map((span) => truncateUnicode(span.text)),
  };
}

function hasAttention(result: EvalStoredResult): boolean {
  return (
    result.evaluated &&
    (result.residualScriptLetters > 0 ||
      result.markerMismatches > 0 ||
      result.adheredGlossaryTerms < result.matchedGlossaryTerms)
  );
}

function addToAggregate(aggregate: EvalAggregate, result: EvalStoredResult): void {
  aggregate.chapterCount += 1;
  if (!result.evaluated) {
    aggregate.skippedChapterCount += 1;
    return;
  }
  aggregate.evaluatedChapterCount += 1;
  aggregate.residualScriptLetters += result.residualScriptLetters;
  aggregate.markerMismatches += result.markerMismatches;
  aggregate.matchedGlossaryTerms += result.matchedGlossaryTerms;
  aggregate.adheredGlossaryTerms += result.adheredGlossaryTerms;
  if (hasAttention(result)) aggregate.attentionChapterCount += 1;
}

async function* selectedChapterCursor(
  novelId: string,
  selection: EvalSelection,
): AsyncGenerator<EvalChapterCursorRow> {
  const rangePredicate =
    selection.mode === "ranges"
      ? queryClient`AND EXISTS (
        SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(selection.ranges)}::jsonb)
          AS selected("from" numeric, "to" numeric)
        WHERE c."number" BETWEEN selected."from" AND selected."to"
      )`
      : queryClient``;
  const limit = selection.mode === "first3" ? queryClient`LIMIT 3` : queryClient``;
  const cursor = queryClient<EvalChapterCursorRow[]>`
    SELECT c."id", c."number"::text AS "number", c."title", c."status",
      c."raw_content" AS "rawContent", c."translated_content" AS "translatedContent",
      to_char(c."updated_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM "chapters" c
    WHERE c."novel_id" = ${novelId} ${rangePredicate}
    ORDER BY c."number", c."id" ${limit}
  `.cursor(CURSOR_BATCH_SIZE);

  for await (const rows of cursor) {
    for (const row of rows) yield row;
  }
}

export async function runTranslationEvalReport(reportId: string) {
  const [report] = await db
    .select({
      status: translationEvalReports.status,
      novelId: translationEvalReports.novelId,
      chapterSelector: translationEvalReports.chapterSelector,
    })
    .from(translationEvalReports)
    .where(eq(translationEvalReports.id, reportId))
    .limit(1);
  if (!report) return { missing: true };
  if (report.status === "done" || report.status === "error") {
    return { skipped: true, status: report.status };
  }

  const [started] = await db
    .update(translationEvalReports)
    .set({ status: "running", updatedAt: new Date() })
    .where(
      and(
        eq(translationEvalReports.id, reportId),
        inArray(translationEvalReports.status, REPORT_STATUSES_IN_PROGRESS),
      ),
    )
    .returning({ id: translationEvalReports.id });
  if (!started) return { skipped: true };

  try {
    const [novel] = await db
      .select({ id: novels.id, sourceLang: novels.sourceLang, targetLang: novels.targetLang })
      .from(novels)
      .where(eq(novels.id, report.novelId))
      .limit(1);
    if (!novel) throw new Error("Novel not found");

    const selection = parseEvalSelection(report.chapterSelector);
    const terms = await db
      .select({ source: glossaryTerms.source, target: glossaryTerms.target })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));
    const approvedTerms = terms.toSorted(compareTerms);
    const languagePair = `${novel.sourceLang}->${novel.targetLang}`;
    const contextFingerprint = createEvalContextFingerprint(
      novel.sourceLang,
      novel.targetLang,
      approvedTerms,
    );
    const protectedTerms = approvedTerms.map((term) => term.target);
    const results: EvalStoredResult[] = [];
    const aggregate: EvalAggregate = {
      chapterCount: 0,
      residualScriptLetters: 0,
      markerMismatches: 0,
      matchedGlossaryTerms: 0,
      adheredGlossaryTerms: 0,
      evaluatedChapterCount: 0,
      skippedChapterCount: 0,
      attentionChapterCount: 0,
    };

    for await (const chapter of selectedChapterCursor(novel.id, selection)) {
      const result = createEvalResult(chapter, languagePair, protectedTerms, approvedTerms);
      results.push(result);
      addToAggregate(aggregate, result);
    }

    const summary = {
      ...aggregate,
      version: 1 as const,
      languagePair,
      contextFingerprint,
    };
    const completedAt = new Date();
    const [completed] = await db
      .update(translationEvalReports)
      .set({
        status: "done",
        chapterCount: aggregate.chapterCount,
        residualScriptLetters: aggregate.residualScriptLetters,
        markerMismatches: aggregate.markerMismatches,
        matchedGlossaryTerms: aggregate.matchedGlossaryTerms,
        adheredGlossaryTerms: aggregate.adheredGlossaryTerms,
        summaryJson: JSON.stringify(summary),
        resultsJson: JSON.stringify(results),
        updatedAt: completedAt,
        completedAt,
      })
      .where(
        and(eq(translationEvalReports.id, reportId), eq(translationEvalReports.status, "running")),
      )
      .returning({ id: translationEvalReports.id });
    if (!completed) return { skipped: true };

    return { done: true, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "Translation evaluation attempt failed", { reportId, error: message });
    throw error;
  }
}

export async function failTranslationEvalReport(reportId: string): Promise<void> {
  await db
    .update(translationEvalReports)
    .set({
      status: "error",
      error: EVAL_FAILURE_ERROR,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(translationEvalReports.id, reportId),
        inArray(translationEvalReports.status, REPORT_STATUSES_IN_PROGRESS),
      ),
    );
}
