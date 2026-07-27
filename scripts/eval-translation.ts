import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, and, inArray, lt, sql, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, glossaryTerms } from "@/lib/db/schema";
import { chunkText } from "@/lib/translation/chunker";
import {
  buildSystemPrompt,
  buildUserMessage,
  findResidualSourceChars,
} from "@/lib/translation/prompts";
import {
  injectParagraphMarkers,
  restoreParagraphMarkers,
  countParagraphMarkers,
  normalizeTranslationOutput,
} from "@/lib/translation/paragraphs";
import { filterGlossaryForChunk, formatGlossaryBlock } from "@/lib/translation/glossary";
import { createProviderClient } from "@/lib/translation/provider-client";

interface ChapterEvalResult {
  chapterNumber: string;
  chapterTitle: string;
  chunkCount?: number;
  totalLatencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  residualHanzi?: number;
  markerMismatches?: number;
  dotArtifactsCaught?: number;
  matchedGlossaryTerms?: number;
  adheredGlossaryTerms?: number;
  glossaryAdherencePercent?: number;
  error?: string;
  chunksCompleted?: number;
}

function parseChapterNumbers(input?: string): number[] {
  if (!input) return [];
  const numbers: number[] = [];
  const parts = input.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) numbers.push(i);
      }
    } else {
      const num = Number(trimmed);
      if (!isNaN(num)) numbers.push(num);
    }
  }
  return numbers;
}

async function runEval() {
  const args = process.argv.slice(2);
  const novelId = args[0];
  const chapterArg = args[1];

  if (!novelId) {
    console.error("Usage: bun run eval:translation <novelId> [chapterNumbers|all]");
    console.error("Example: bun run eval:translation novel_123 1,2,3-5");
    console.error("Example: bun run eval:translation novel_123 all");
    process.exit(1);
  }

  const [novel] = await db.select().from(novels).where(eq(novels.id, novelId)).limit(1);
  if (!novel) {
    console.error(`Novel with ID "${novelId}" not found.`);
    process.exit(1);
  }

  const isAll = chapterArg === "all" || chapterArg === "--all";
  const requestedNumbers = isAll ? [] : parseChapterNumbers(chapterArg);

  let query = db
    .select()
    .from(chapters)
    .where(
      requestedNumbers.length > 0
        ? and(eq(chapters.novelId, novelId), inArray(chapters.number, requestedNumbers.map(String)))
        : eq(chapters.novelId, novelId),
    )
    .orderBy(sql`COALESCE(${chapters.number}::numeric, 0)`);

  let targetChapters = await (requestedNumbers.length === 0 && !isAll ? query.limit(3) : query);

  if (targetChapters.length === 0) {
    console.error(`No chapters found for novel "${novelId}" matching input criteria.`);
    process.exit(1);
  }

  if (!chapterArg) {
    console.log(
      "Notice: No chapter numbers specified — defaulting to first 3 chapters. (Pass 'all' or specific numbers like '1,2,3' to evaluate more).\n",
    );
  }

  const providerConfig = await createProviderClient(novel.userId);
  const pair = `${novel.sourceLang}->${novel.targetLang}`;

  console.log(`Starting translation evaluation for novel "${novel.title}" (${novel.id})`);
  console.log(
    `Evaluating ${targetChapters.length} chapter(s). Provider: ${providerConfig.provider}, Model: ${providerConfig.model}\n`,
  );

  const allApprovedTerms = await db
    .select({
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      category: glossaryTerms.category,
      note: glossaryTerms.note,
    })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));

  const evalResults: ChapterEvalResult[] = [];

  for (const chapter of targetChapters) {
    console.log(
      `Evaluating Chapter ${chapter.number}: "${chapter.title}" (${chapter.rawContent.length} chars)...`,
    );

    let completedChunksCount = 0;
    let totalChunkCount = 0;

    try {
      const chunkTexts = chunkText(chapter.rawContent, novel.chunkSize);
      totalChunkCount = chunkTexts.length;

      // Get previous chapter summary & tail fallback (matching worker.ts)
      const [prevChapter] = await db
        .select({
          summary: chapters.summary,
          translatedContent: chapters.translatedContent,
        })
        .from(chapters)
        .where(
          and(
            eq(chapters.novelId, novel.id),
            lt(sql`COALESCE(${chapters.number}::numeric, 0)`, sql`${chapter.number}::numeric`),
            eq(chapters.status, "translated"),
          ),
        )
        .orderBy(desc(sql`COALESCE(${chapters.number}::numeric, 0)`))
        .limit(1);

      const previousSummary = novel.storySummary || prevChapter?.summary || null;
      const tailLen = novel.contextTailLength || 500;
      let previousChunkTail: string | null = prevChapter?.translatedContent
        ? prevChapter.translatedContent.slice(-tailLen)
        : null;

      let totalLatencyMs = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let residualHanzi = 0;
      let markerMismatches = 0;
      let dotArtifactsCaught = 0;
      let matchedGlossaryTerms = 0;
      let adheredGlossaryTerms = 0;

      for (let i = 0; i < chunkTexts.length; i++) {
        const chunk = chunkTexts[i];
        const matchedTerms = filterGlossaryForChunk(allApprovedTerms, chunk.text);
        const glossaryBlock = formatGlossaryBlock(matchedTerms);

        const systemPrompt = buildSystemPrompt(
          pair,
          glossaryBlock,
          { previousSummary },
          novel.customPrompt,
        );

        const markedText = injectParagraphMarkers(chunk.text);
        const expectedMarkers = countParagraphMarkers(markedText);
        const userMessage = buildUserMessage(markedText, previousChunkTail);

        const startTime = Date.now();
        const completion = await providerConfig.generateChatCompletion({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
        });
        const latency = Date.now() - startTime;
        totalLatencyMs += latency;

        promptTokens += completion.usage?.promptTokens || 0;
        completionTokens += completion.usage?.completionTokens || 0;

        const rawCompletion = completion.content || "";
        const restored = restoreParagraphMarkers(rawCompletion);
        const actualMarkers = countParagraphMarkers(rawCompletion);
        markerMismatches += Math.abs(expectedMarkers - actualMarkers);

        const hanzi = findResidualSourceChars(pair, restored);
        residualHanzi += hanzi.length;

        const dotMatches = (rawCompletion.match(/[.·‥…⋯⋅・⸰．‧]{2,}/g) || []).length;
        dotArtifactsCaught += dotMatches;

        const normalizedChunkOutput = normalizeTranslationOutput(restored);

        for (const term of matchedTerms) {
          matchedGlossaryTerms++;
          if (normalizedChunkOutput.includes(term.target.trim())) {
            adheredGlossaryTerms++;
          }
        }

        previousChunkTail = normalizedChunkOutput.slice(-tailLen);
        completedChunksCount++;
      }

      const glossaryAdherencePercent =
        matchedGlossaryTerms > 0
          ? Number(((adheredGlossaryTerms / matchedGlossaryTerms) * 100).toFixed(1))
          : 100;

      evalResults.push({
        chapterNumber: String(chapter.number),
        chapterTitle: chapter.title,
        chunkCount: chunkTexts.length,
        totalLatencyMs,
        promptTokens,
        completionTokens,
        residualHanzi,
        markerMismatches,
        dotArtifactsCaught,
        matchedGlossaryTerms,
        adheredGlossaryTerms,
        glossaryAdherencePercent,
      });
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      console.error(`Error evaluating Chapter ${chapter.number}: ${errorMsg}`);
      evalResults.push({
        chapterNumber: String(chapter.number),
        chapterTitle: chapter.title,
        chunkCount: totalChunkCount,
        chunksCompleted: completedChunksCount,
        error: errorMsg,
      });
    }
  }

  console.log("\n=================== EVALUATION RESULTS ===================");
  console.table(
    evalResults.map((r) => ({
      Ch: r.chapterNumber,
      Status: r.error ? `ERR: ${r.error.slice(0, 25)}` : "OK",
      Chunks: r.error
        ? `${r.chunksCompleted ?? 0}/${r.chunkCount ?? 0}`
        : String(r.chunkCount ?? 0),
      "Latency (s)": r.totalLatencyMs !== undefined ? (r.totalLatencyMs / 1000).toFixed(1) : "-",
      "Latency (s)": r.totalLatencyMs !== undefined ? (r.totalLatencyMs / 1000).toFixed(1) : "-",
      "Prompt Tok": r.promptTokens ?? "-",
      "Comp Tok": r.completionTokens ?? "-",
      "Residual Hanzi": r.residualHanzi ?? "-",
      "Marker Misses": r.markerMismatches ?? "-",
      "Dot Artifacts": r.dotArtifactsCaught ?? "-",
      "Glossary Match/Adhered":
        r.matchedGlossaryTerms !== undefined
          ? `${r.adheredGlossaryTerms}/${r.matchedGlossaryTerms}`
          : "-",
      "Glossary %":
        r.glossaryAdherencePercent !== undefined ? `${r.glossaryAdherencePercent}%` : "-",
    })),
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = join(process.cwd(), "evals", "results");
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const outputPath = join(resultsDir, `${timestamp}.json`);
  const outputData = {
    timestamp: new Date().toISOString(),
    metrics: "pre-correction",
    novelId: novel.id,
    novelTitle: novel.title,
    pair,
    provider: providerConfig.provider,
    model: providerConfig.model,
    results: evalResults,
  };

  writeFileSync(outputPath, JSON.stringify(outputData, null, 2), "utf8");
  console.log(`\nResults written to: ${outputPath}`);
}

runEval().catch((err) => {
  console.error("Eval script failed:", err);
  process.exit(1);
});
