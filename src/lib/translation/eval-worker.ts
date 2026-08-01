import "@tanstack/react-start/server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels, translationEvalReports } from "@/lib/db/schema";
import { splitParagraphs } from "@/lib/translation/paragraphs";
import { findResidualSourceChars } from "@/lib/translation/prompts";

function parseSelector(selector: string): number[] | null {
  const normalized = selector.trim().toLowerCase();
  if (!normalized || normalized === "first3") return [];
  if (normalized === "all") return null;
  const numbers: number[] = [];
  for (const part of normalized.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map((n) => Number(n));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      for (let i = start; i <= end; i++) numbers.push(i);
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n)) numbers.push(n);
    }
  }
  return numbers;
}

export async function runTranslationEvalReport(reportId: string) {
  await db
    .update(translationEvalReports)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(translationEvalReports.id, reportId));

  try {
    const [report] = await db
      .select()
      .from(translationEvalReports)
      .where(eq(translationEvalReports.id, reportId))
      .limit(1);
    if (!report) return { missing: true };

    const [novel] = await db.select().from(novels).where(eq(novels.id, report.novelId)).limit(1);
    if (!novel) throw new Error("Novel not found");

    const parsed = parseSelector(report.chapterSelector);
    const selectedChapters = await db
      .select()
      .from(chapters)
      .where(
        parsed && parsed.length > 0
          ? and(eq(chapters.novelId, novel.id), inArray(chapters.number, parsed.map(String)))
          : eq(chapters.novelId, novel.id),
      )
      .orderBy(sql`COALESCE(${chapters.number}::numeric, 0)`)
      .limit(parsed === null ? 1000 : parsed.length > 0 ? parsed.length : 3);

    const terms = await db
      .select()
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));

    const pair = `${novel.sourceLang}->${novel.targetLang}`;
    const results = selectedChapters.map((chapter) => {
      const translated = chapter.translatedContent || "";
      const rawParagraphCount = splitParagraphs(chapter.rawContent).length;
      const translatedParagraphCount = translated ? splitParagraphs(translated).length : 0;
      const residual = translated ? findResidualSourceChars(pair, translated).length : 0;
      const matchedTerms = terms.filter((term) => chapter.rawContent.includes(term.source));
      const adheredTerms = matchedTerms.filter((term) => translated.includes(term.target));
      return {
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        status: chapter.status,
        residualCjk: residual,
        markerMismatches: Math.abs(rawParagraphCount - translatedParagraphCount),
        matchedGlossaryTerms: matchedTerms.length,
        adheredGlossaryTerms: adheredTerms.length,
        glossaryAdherencePercent:
          matchedTerms.length > 0
            ? Math.round((adheredTerms.length / matchedTerms.length) * 100)
            : null,
      };
    });

    const summary = results.reduce(
      (acc, result) => ({
        chapterCount: acc.chapterCount + 1,
        residualCjk: acc.residualCjk + result.residualCjk,
        markerMismatches: acc.markerMismatches + result.markerMismatches,
        matchedGlossaryTerms: acc.matchedGlossaryTerms + result.matchedGlossaryTerms,
        adheredGlossaryTerms: acc.adheredGlossaryTerms + result.adheredGlossaryTerms,
      }),
      {
        chapterCount: 0,
        residualCjk: 0,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
      },
    );

    await db
      .update(translationEvalReports)
      .set({
        status: "done",
        chapterCount: summary.chapterCount,
        residualCjk: summary.residualCjk,
        markerMismatches: summary.markerMismatches,
        matchedGlossaryTerms: summary.matchedGlossaryTerms,
        adheredGlossaryTerms: summary.adheredGlossaryTerms,
        summaryJson: JSON.stringify(summary),
        resultsJson: JSON.stringify(results),
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(translationEvalReports.id, reportId));

    return { done: true, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(translationEvalReports)
      .set({ status: "error", error: message, updatedAt: new Date(), completedAt: new Date() })
      .where(eq(translationEvalReports.id, reportId));
    throw error;
  }
}
