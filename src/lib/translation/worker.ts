import "@tanstack/react-start/server-only";
import { eq, and, sql, lt, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "./provider-client";
import type { AIProviderClient } from "./translation.types";
import { splitAtParagraphBoundary } from "./chunker";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildSummaryPrompt,
  findResidualSourceChars,
} from "./prompts";
import { translateChapterTitle } from "./title";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";
import {
  buildTermSuggestionPrompt,
  buildTermSuggestionUserMessage,
  parseTermSuggestions,
  buildGlossaryReviewPrompt,
  parseGlossaryReviewResponse,
} from "./suggest-terms-prompt";
import {
  injectParagraphMarkers,
  restoreParagraphMarkers,
  countParagraphMarkers,
  normalizeTranslationOutput,
} from "./paragraphs";
import { extractHanziSpans, spliceSpans } from "./residual-repair";
import { createLog } from "./translation.functions";
import type { ChunkProgress, LogEntry } from "./translation.types";
import { log } from "@/lib/log";

// Execution is driven by Inngest (see src/lib/inngest/functions.ts): one event
// per job, each chunk a memoized step with its own invocation + retries — so no
// lease, no cron pinger. DB status rows stay the UI's source of truth.

async function loadJob(jobId: string) {
  const [row] = await db
    .select({ job: translationJobs, chapter: chapters, novel: novels })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(translationJobs.id, jobId))
    .limit(1);
  return row ?? null;
}

async function saveJob(jobId: string, patch: Record<string, unknown>) {
  await db
    .update(translationJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(translationJobs.id, jobId));
}

export async function initJob(jobId: string) {
  log("info", "step transition", { jobId, step: "init" });
  const row = await loadJob(jobId);
  if (!row) throw new Error(`Job ${jobId} not found`);
  const { job, chapter } = row;

  // Cancelled/done/errored before the run started (e.g. replaced by a newer job).
  if (job.status !== "pending" && job.status !== "running") {
    return { skip: true as const, doneChunks: 0, totalChunks: 0 };
  }

  if (job.status !== "running") {
    await saveJob(job.id, { status: "running" });
    await db
      .update(chapters)
      .set({ status: "translating", updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));
  }

  const chunkList: ChunkProgress[] = JSON.parse(job.chunksJson || "[]");
  return { skip: false as const, doneChunks: job.doneChunks, totalChunks: chunkList.length };
}

interface TranslatePieceResult {
  translation: string;
  promptTokens: number;
  completionTokens: number;
}

async function translatePiece(
  text: string,
  previousTail: string | null,
  providerConfig: AIProviderClient,
  systemPrompt: string,
  langPair: string,
  logs: LogEntry[],
  chunkLabel: string,
): Promise<TranslatePieceResult> {
  const markedText = injectParagraphMarkers(text);
  const expectedMarkers = countParagraphMarkers(markedText);
  const userMessage = buildUserMessage(markedText, previousTail);

  const completion = await providerConfig.generateChatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  let translation = completion.content || "";

  if (!translation.trim()) {
    throw new Error("Empty completion");
  }

  let promptTokens = completion.usage?.promptTokens || 0;
  let completionTokens = completion.usage?.completionTokens || 0;

  // Restore paragraph markers and check count
  const receivedMarkers = countParagraphMarkers(translation);
  if (receivedMarkers !== expectedMarkers && expectedMarkers > 0) {
    try {
      const markerFix = await providerConfig.generateChatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
          { role: "assistant", content: translation },
          {
            role: "user",
            content: `Your translation has ${receivedMarkers} ||¶|| markers but the source has ${expectedMarkers}. Re-output the COMPLETE translation preserving every ||¶|| marker exactly as-is in the correct positions. Output only the corrected translation.`,
          },
        ],
      });
      promptTokens += markerFix.usage?.promptTokens || 0;
      completionTokens += markerFix.usage?.completionTokens || 0;
      const fixed = markerFix.content || "";
      const fixedMarkers = countParagraphMarkers(fixed);
      if (fixed.trim() && fixedMarkers === expectedMarkers) {
        translation = fixed;
        logs.push(createLog("success", `${chunkLabel} marker count corrected.`));
      } else if (fixed.trim()) {
        logs.push(
          createLog(
            "warn",
            `${chunkLabel} marker fix didn't match (${fixedMarkers}/${expectedMarkers}) — keeping original.`,
          ),
        );
      }
    } catch (markerFixErr) {
      logs.push(
        createLog(
          "warn",
          `${chunkLabel} marker fix failed (${markerFixErr instanceof Error ? markerFixErr.message : "error"}) — keeping original.`,
        ),
      );
    }
  }

  // Residual-hanzi repair runs on the MARKED text, so the "preserve ||¶|| markers"
  // instruction in the retry prompt stays truthful; restore once at the end.
  const repaired = await repairResidualHanzi(
    translation,
    providerConfig,
    systemPrompt,
    userMessage,
    langPair,
    logs,
    chunkLabel,
  );
  promptTokens += repaired.promptTokens;
  completionTokens += repaired.completionTokens;
  translation = restoreParagraphMarkers(repaired.translation);

  return { translation, promptTokens, completionTokens };
}

// ---------------------------------------------------------------------------
// Residual hanzi repair
// ---------------------------------------------------------------------------

// Surgical splice first (cheap, precise — the common case is short spans like
// bracketed system lines and names). Whole-chunk retry only when a long span
// signals a passage-level failure: spliced prose would have incoherent seams.
// Never loops — whatever survives is kept and surfaced via the admin badge.
const LONG_SPAN_LIMIT = 200;

async function repairResidualHanzi(
  translation: string,
  providerConfig: AIProviderClient,
  systemPrompt: string,
  userMessage: string,
  langPair: string,
  logs: LogEntry[],
  chunkLabel: string,
): Promise<TranslatePieceResult> {
  let text = translation;
  let promptTokens = 0;
  let completionTokens = 0;

  const initial = findResidualSourceChars(langPair, text);
  if (initial.length <= 2) return { translation: text, promptTokens, completionTokens };
  logs.push(
    createLog("warn", `${chunkLabel} has ${initial.length} untranslated hanzi — repairing.`),
  );

  if (extractHanziSpans(text).some((s) => s.text.length > LONG_SPAN_LIMIT)) {
    try {
      const fix = await providerConfig.generateChatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
          { role: "assistant", content: text },
          {
            role: "user",
            content:
              "Your translation still contains untranslated Chinese text. Re-output the COMPLETE translation with every Chinese word translated or transliterated — including bracketed lines, notifications, and all names. Preserve every ||¶|| marker exactly. Output only the corrected translation.",
          },
        ],
      });
      promptTokens += fix.usage?.promptTokens || 0;
      completionTokens += fix.usage?.completionTokens || 0;
      if ((fix.content || "").trim()) {
        text = fix.content;
        logs.push(createLog("info", `${chunkLabel} re-requested for untranslated passage.`));
      }
    } catch (fixErr) {
      logs.push(
        createLog(
          "warn",
          `${chunkLabel} re-translation failed (${fixErr instanceof Error ? fixErr.message : "error"}) — keeping original.`,
        ),
      );
    }
  }

  // Surgical splice for what remains (primary path, or stragglers after retry).
  const spans = extractHanziSpans(text);
  const stillDirty = findResidualSourceChars(langPair, text).length > 2;
  if (stillDirty && spans.length > 0 && spans.every((s) => s.text.length <= LONG_SPAN_LIMIT)) {
    try {
      const targetLang = langPair.toLowerCase().endsWith("th") ? "Thai" : "English";
      const repair = await providerConfig.generateChatCompletion({
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You translate Chinese web-novel fragments into ${targetLang}. Translate or transliterate every Chinese word, including names — no Chinese characters in the output. Reply with JSON: {"translations": [...]} — one translated string per input segment, same order and count.`,
          },
          { role: "user", content: JSON.stringify({ segments: spans.map((s) => s.text) }) },
        ],
        responseFormat: { type: "json_object" },
      });
      promptTokens += repair.usage?.promptTokens || 0;
      completionTokens += repair.usage?.completionTokens || 0;

      const parsed = JSON.parse(repair.content || "{}");
      const replacements: unknown = Array.isArray(parsed) ? parsed : parsed?.translations;
      const spliced =
        Array.isArray(replacements) && replacements.every((r): r is string => typeof r === "string")
          ? spliceSpans(text, spans, replacements)
          : null;

      if (spliced) {
        const left = findResidualSourceChars(langPair, spliced).length;
        text = spliced;
        logs.push(
          createLog(
            left > 2 ? "warn" : "success",
            left > 2
              ? `${chunkLabel} still has ${left} hanzi after span repair — keeping anyway.`
              : `${chunkLabel} hanzi spans repaired.`,
          ),
        );
      } else {
        logs.push(
          createLog(
            "warn",
            `${chunkLabel} span repair returned mismatched segments — keeping original.`,
          ),
        );
      }
    } catch (spanErr) {
      logs.push(
        createLog(
          "warn",
          `${chunkLabel} span repair failed (${spanErr instanceof Error ? spanErr.message : "error"}) — keeping original.`,
        ),
      );
    }
  } else if (stillDirty) {
    logs.push(
      createLog(
        "warn",
        `${chunkLabel} still has ${findResidualSourceChars(langPair, text).length} hanzi after retry — keeping anyway.`,
      ),
    );
  }

  return { translation: text, promptTokens, completionTokens };
}

export async function translateChunk(jobId: string, i: number): Promise<void> {
  log("info", "step transition", { jobId, step: "translateChunk", chunk: i });
  const row = await loadJob(jobId);
  if (!row) throw new Error(`Job ${jobId} not found`);
  const { job, chapter, novel } = row;

  // Cancelled mid-run, or this chunk already landed in a previous attempt.
  if (job.status !== "running" && job.status !== "pending") return;
  if (i < job.doneChunks) return;

  const providerConfig = await createProviderClient(novel.userId);

  const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
  const chunkList: ChunkProgress[] = JSON.parse(job.chunksJson || "[]");
  const currentChunk = chunkList[i];
  if (!currentChunk) throw new Error(`Chunk ${i} missing in job ${jobId}`);

  logs.push(
    createLog(
      "info",
      `Translating chunk ${i + 1}/${chunkList.length} (${currentChunk.text.length.toLocaleString()} chars)...`,
    ),
  );

  // Approved glossary terms for the novel
  const terms = await db
    .select({
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      category: glossaryTerms.category,
      note: glossaryTerms.note,
    })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));

  // Previous chapter summary for rolling context
  const [prevChapter] = await db
    .select({ summary: chapters.summary, translatedContent: chapters.translatedContent })
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
  let previousChunkTail: string | null = null;
  if (i > 0 && chunkList[i - 1]?.translation) {
    previousChunkTail = chunkList[i - 1].translation!.slice(-tailLen);
  } else if (i === 0 && prevChapter?.translatedContent) {
    previousChunkTail = prevChapter.translatedContent.slice(-tailLen);
  }

  const matchedTerms = filterGlossaryForChunk(terms, currentChunk.text);
  const glossaryBlock = formatGlossaryBlock(matchedTerms);
  if (matchedTerms.length > 0) {
    logs.push(
      createLog(
        "info",
        `Injected ${matchedTerms.length} glossary term(s): ${matchedTerms.map((t) => t.source).join(", ")}`,
      ),
    );
  }

  const systemPrompt = buildSystemPrompt(
    `${novel.sourceLang}->${novel.targetLang}`,
    glossaryBlock,
    { previousSummary },
    novel.customPrompt,
  );

  const langPair = `${novel.sourceLang}->${novel.targetLang}`;
  const chunkLabel = `Chunk ${i + 1}/${chunkList.length}`;

  async function translatePieceWithAutoSplit(
    text: string,
    prevTail: string | null,
    depth = 0,
  ): Promise<TranslatePieceResult> {
    try {
      return await translatePiece(
        text,
        prevTail,
        providerConfig,
        systemPrompt,
        langPair,
        logs,
        chunkLabel,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.toLowerCase() : "";
      const isTimeout =
        errMsg.includes("timed out") ||
        (err instanceof Error && err.name === "APIConnectionTimeoutError");
      if (isTimeout && text.length > 1200 && depth < 2) {
        logs.push(
          createLog(
            "warn",
            `${chunkLabel} timed out (${text.length} chars, depth ${depth}). Auto-splitting into halves...`,
          ),
        );
        // ponytail: upgrade path — if 5-min budget per half is needed in future, split into separate Inngest steps.
        const [half1, half2] = splitAtParagraphBoundary(text);
        if (half1.length > 0 && half2.length > 0) {
          const res1 = await translatePieceWithAutoSplit(half1, prevTail, depth + 1);
          const tail1 = res1.translation.slice(-tailLen);
          const res2 = await translatePieceWithAutoSplit(half2, tail1, depth + 1);
          return {
            translation: `${res1.translation}\n\n${res2.translation}`,
            promptTokens: res1.promptTokens + res2.promptTokens,
            completionTokens: res1.completionTokens + res2.completionTokens,
          };
        }
      }
      throw err;
    }
  }

  const startTime = Date.now();
  let result: TranslatePieceResult;

  try {
    result = await translatePieceWithAutoSplit(currentChunk.text, previousChunkTail, 0);
  } catch (err) {
    // Record which chunk failed for the UI, then rethrow — Inngest owns retries.
    currentChunk.error = err instanceof Error ? err.message : "API Error";
    chunkList[i] = currentChunk;
    logs.push(
      createLog("warn", `Chunk ${i + 1}/${chunkList.length} failed: ${currentChunk.error}`),
    );
    await saveJob(job.id, {
      chunksJson: JSON.stringify(chunkList),
      logsJson: JSON.stringify(logs),
    });
    throw err;
  }

  const elapsedMs = Date.now() - startTime;
  const translation = result.translation;
  const promptTokens = result.promptTokens;
  const completionTokens = result.completionTokens;

  currentChunk.translation = translation;
  currentChunk.promptTokens = promptTokens;
  currentChunk.completionTokens = completionTokens;
  currentChunk.latencyMs = elapsedMs;
  delete currentChunk.error;
  chunkList[i] = currentChunk;

  logs.push(
    createLog(
      "success",
      `Chunk ${i + 1}/${chunkList.length} completed in ${(elapsedMs / 1000).toFixed(1)}s (tokens: ${promptTokens} prompt + ${completionTokens} completion).`,
    ),
  );

  await saveJob(job.id, {
    doneChunks: i + 1,
    chunksJson: JSON.stringify(chunkList),
    logsJson: JSON.stringify(logs),
  });
}

export async function finalizeJob(jobId: string): Promise<void> {
  log("info", "step transition", { jobId, step: "finalize" });
  const row = await loadJob(jobId);
  if (!row) throw new Error(`Job ${jobId} not found`);
  const { job, chapter, novel } = row;

  if (job.status === "done") return; // replay of an already-finalized run
  if (job.status !== "running") return; // cancelled mid-run

  const providerConfig = await createProviderClient(novel.userId);

  const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
  const chunkList: ChunkProgress[] = JSON.parse(job.chunksJson || "[]");
  if (job.doneChunks < chunkList.length) {
    throw new Error(
      `Job ${jobId} finalize called with ${job.doneChunks}/${chunkList.length} chunks`,
    );
  }

  logs.push(createLog("info", "All chunks translated. Assembling chapter..."));

  const fullTranslation = normalizeTranslationOutput(
    chunkList.map((c) => c.translation || "").join("\n\n"),
  );
  let totalPromptTokens = chunkList.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
  let totalCompletionTokens = chunkList.reduce((acc, c) => acc + (c.completionTokens || 0), 0);

  await db
    .update(chapters)
    .set({
      translatedContent: fullTranslation,
      status: "translated",
      translatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chapters.id, chapter.id));

  // Translate chapter title (cheap, non-fatal)
  const titleRes = await translateChapterTitle(
    providerConfig,
    `${novel.sourceLang}->${novel.targetLang}`,
    chapter.title,
  );
  totalPromptTokens += titleRes.promptTokens;
  totalCompletionTokens += titleRes.completionTokens;
  if (titleRes.translated) {
    await db
      .update(chapters)
      .set({ translatedTitle: titleRes.translated, updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));
    logs.push(createLog("success", `Title translated: "${titleRes.translated}"`));
  } else {
    logs.push(createLog("warn", "Title translation skipped — keeping raw title."));
  }

  // Generate chapter summary in English
  logs.push(createLog("info", "Generating English chapter summary..."));
  await saveJob(job.id, { logsJson: JSON.stringify(logs) });
  const summaryStartTime = Date.now();

  let freshSummary: string | null = null;
  try {
    const summarySystemPrompt = buildSummaryPrompt(`${novel.sourceLang}->${novel.targetLang}`);
    const summaryCompletion = await providerConfig.generateChatCompletion({
      model: providerConfig.fastModel ?? undefined,
      messages: [
        { role: "system", content: summarySystemPrompt },
        {
          role: "user",
          content: `Please summarize this chapter:\n\n${
            fullTranslation.length > 10000
              ? `${fullTranslation.slice(0, 6000)}\n[...]\n${fullTranslation.slice(-4000)}`
              : fullTranslation
          }`,
        },
      ],
    });
    totalPromptTokens += summaryCompletion.usage?.promptTokens || 0;
    totalCompletionTokens += summaryCompletion.usage?.completionTokens || 0;
    freshSummary = summaryCompletion.content || null;
    const summaryTime = ((Date.now() - summaryStartTime) / 1000).toFixed(1);
    logs.push(createLog("success", `Summary generated in ${summaryTime}s.`));

    if (freshSummary) {
      await db
        .update(chapters)
        .set({ summary: freshSummary, updatedAt: new Date() })
        .where(eq(chapters.id, chapter.id));

      // Update rolling story summary on novel (non-fatal)
      try {
        const storySummaryCompletion = await providerConfig.generateChatCompletion({
          model: providerConfig.fastModel ?? undefined,
          messages: [
            {
              role: "system",
              content:
                "You are a novel continuity editor. Maintain a running story synopsis (≤400 words in English) of the novel so far. Combine the existing story synopsis with the new chapter summary to create an updated, coherent summary of key events, ongoing plot arcs, and main character states. Output ONLY the updated synopsis.",
            },
            {
              role: "user",
              content: `Existing story synopsis:\n${
                novel.storySummary || "None (this is the beginning of the novel)."
              }\n\nNew chapter summary:\n${freshSummary}`,
            },
          ],
        });
        totalPromptTokens += storySummaryCompletion.usage?.promptTokens || 0;
        totalCompletionTokens += storySummaryCompletion.usage?.completionTokens || 0;
        const updatedStorySummary = storySummaryCompletion.content?.trim();
        if (updatedStorySummary) {
          await db
            .update(novels)
            .set({ storySummary: updatedStorySummary, updatedAt: new Date() })
            .where(eq(novels.id, novel.id));
          logs.push(createLog("info", "Updated rolling story summary."));
        }
      } catch (storyErr) {
        logs.push(
          createLog(
            "warn",
            `Rolling story summary update skipped: ${storyErr instanceof Error ? storyErr.message : "Failed"}`,
          ),
        );
      }
    }
  } catch (sumErr) {
    logs.push(
      createLog(
        "warn",
        `Summary generation skipped: ${sumErr instanceof Error ? sumErr.message : "Failed"}`,
      ),
    );
  }

  // Auto-suggest glossary terms with AI review
  logs.push(createLog("info", "Extracting new glossary term suggestions..."));
  await saveJob(job.id, { logsJson: JSON.stringify(logs) });
  try {
    const [approvedTerms, rejectedTerms] = await Promise.all([
      db
        .select({ source: glossaryTerms.source, target: glossaryTerms.target })
        .from(glossaryTerms)
        .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved"))),
      db
        .select({ source: glossaryTerms.source })
        .from(glossaryTerms)
        .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "rejected"))),
    ]);

    const excludedSources = [
      ...approvedTerms.map((t) => t.source),
      ...rejectedTerms.map((t) => t.source),
    ];

    const fullRawSource = chunkList.map((c) => c.text || "").join("\n\n");
    const rawSourceExcerpt = fullRawSource.slice(0, 4000);
    const translatedExcerpt = fullTranslation.slice(0, 8000);

    const effectiveSummary = freshSummary || chapter.summary || undefined;
    const suggestPrompt = buildTermSuggestionPrompt(
      `${novel.sourceLang}->${novel.targetLang}`,
      excludedSources,
      {
        rawSourceExcerpt,
        chapterSummary: effectiveSummary,
        approvedMappings: approvedTerms.map((t) => ({ source: t.source, target: t.target })),
      },
    );

    const userMessage = buildTermSuggestionUserMessage(translatedExcerpt, {
      rawSourceExcerpt,
      chapterSummary: effectiveSummary,
    });

    let suggestionContent = "";
    try {
      const suggestCompletion = await providerConfig.generateChatCompletion({
        temperature: 0.3,
        model: providerConfig.fastModel ?? undefined,
        messages: [
          { role: "system", content: suggestPrompt },
          { role: "user", content: userMessage },
        ],
        responseFormat: { type: "json_object" },
      });
      totalPromptTokens += suggestCompletion.usage?.promptTokens || 0;
      totalCompletionTokens += suggestCompletion.usage?.completionTokens || 0;
      suggestionContent = suggestCompletion.content || "";
    } catch {
      const suggestCompletion = await providerConfig.generateChatCompletion({
        temperature: 0.3,
        model: providerConfig.fastModel ?? undefined,
        messages: [
          { role: "system", content: suggestPrompt },
          { role: "user", content: userMessage },
        ],
      });
      totalPromptTokens += suggestCompletion.usage?.promptTokens || 0;
      totalCompletionTokens += suggestCompletion.usage?.completionTokens || 0;
      suggestionContent = suggestCompletion.content || "";
    }

    const suggestedTerms = parseTermSuggestions(suggestionContent);

    // AI review of extracted terms
    let reviewResults: Awaited<ReturnType<typeof parseGlossaryReviewResponse>> = [];
    if (suggestedTerms.length > 0) {
      logs.push(
        createLog("info", `Reviewing ${suggestedTerms.length} suggested term(s) with AI...`),
      );
      await saveJob(job.id, { logsJson: JSON.stringify(logs) });

      try {
        const reviewPrompt = buildGlossaryReviewPrompt(
          `${novel.sourceLang}->${novel.targetLang}`,
          approvedTerms.map((t) => ({ source: t.source, target: t.target })),
        );

        const reviewUserMessage = [
          "Review these suggested glossary terms:",
          JSON.stringify({ terms: suggestedTerms }, null, 2),
          "",
          "Source text excerpt:",
          rawSourceExcerpt.slice(0, 3000),
          "",
          "Translated excerpt:",
          translatedExcerpt.slice(0, 3000),
        ].join("\n");

        let reviewContent = "";
        try {
          const reviewCompletion = await providerConfig.generateChatCompletion({
            temperature: 0.1,
            model: providerConfig.fastModel ?? undefined,
            messages: [
              { role: "system", content: reviewPrompt },
              { role: "user", content: reviewUserMessage },
            ],
            responseFormat: { type: "json_object" },
          });
          totalPromptTokens += reviewCompletion.usage?.promptTokens || 0;
          totalCompletionTokens += reviewCompletion.usage?.completionTokens || 0;
          reviewContent = reviewCompletion.content || "";
        } catch {
          const reviewCompletion = await providerConfig.generateChatCompletion({
            temperature: 0.1,
            model: providerConfig.fastModel ?? undefined,
            messages: [
              { role: "system", content: reviewPrompt },
              { role: "user", content: reviewUserMessage },
            ],
          });
          totalPromptTokens += reviewCompletion.usage?.promptTokens || 0;
          totalCompletionTokens += reviewCompletion.usage?.completionTokens || 0;
          reviewContent = reviewCompletion.content || "";
        }

        reviewResults = parseGlossaryReviewResponse(reviewContent);
      } catch (reviewErr) {
        logs.push(
          createLog(
            "warn",
            `AI review failed (${reviewErr instanceof Error ? reviewErr.message : "error"}) — all terms stored as pending.`,
          ),
        );
      }
    }

    const reviewBySource = new Map(reviewResults.map((r) => [r.source, r]));
    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    let conflictCount = 0;

    for (const st of suggestedTerms) {
      const review = reviewBySource.get(st.source);
      const finalTarget =
        review?.target && review.target.trim().length > 0 ? review.target : st.target;

      // Validity guard: non-empty source, non-empty target, source !== target (case/whitespace-insensitive)
      if (
        !st.source.trim().length ||
        !finalTarget.trim().length ||
        finalTarget.trim().toLowerCase() === st.source.trim().toLowerCase()
      ) {
        rejectedCount++;
        continue;
      }

      // Check for existing term (duplicate case/whitespace-insensitive)
      const [dup] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .where(
          and(
            eq(glossaryTerms.novelId, novel.id),
            sql`lower(trim(${glossaryTerms.source})) = lower(trim(${st.source}))`,
          ),
        )
        .limit(1);

      if (dup) {
        // Existing term (approved, pending, or rejected) — skip
        conflictCount++;
        continue;
      }

      // High-confidence reject → skip insertion
      if (review?.action === "reject" && review.confidence === "high") {
        rejectedCount++;
        continue;
      }

      // High-confidence approve with valid evidence → insert as approved
      // Deterministic validation: source must appear in raw text, target in translation
      const sourceInRaw = fullRawSource.includes(st.source);
      const targetInTranslation = fullTranslation.includes(finalTarget);
      if (
        review?.action === "approve" &&
        review.confidence === "high" &&
        sourceInRaw &&
        targetInTranslation
      ) {
        await db.insert(glossaryTerms).values({
          id: nanoid(),
          novelId: novel.id,
          source: st.source,
          target: finalTarget,
          category: st.category,
          note: st.note || null,
          status: "approved",
        });
        approvedCount++;
      } else {
        // Uncertain or no review → store as pending
        await db.insert(glossaryTerms).values({
          id: nanoid(),
          novelId: novel.id,
          source: st.source,
          target: finalTarget,
          category: st.category,
          note: st.note || null,
          status: "pending",
        });
        pendingCount++;
      }
    }

    const summary: string[] = [];
    if (approvedCount > 0) summary.push(`${approvedCount} approved`);
    if (pendingCount > 0) summary.push(`${pendingCount} pending`);
    if (rejectedCount > 0) summary.push(`${rejectedCount} rejected`);
    if (conflictCount > 0) summary.push(`${conflictCount} conflicts`);

    if (summary.length > 0) {
      logs.push(createLog("success", `Glossary review: ${summary.join(", ")}.`));
    } else {
      logs.push(createLog("info", "No new term suggestions extracted."));
    }
  } catch (sugErr) {
    logs.push(
      createLog(
        "warn",
        `Term auto-suggest skipped: ${sugErr instanceof Error ? sugErr.message : "Failed"}`,
      ),
    );
  }

  logs.push(
    createLog(
      "success",
      `Job completed! Total tokens: ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} prompt + ${totalCompletionTokens} completion).`,
    ),
  );

  await saveJob(job.id, {
    status: "done",
    chunksJson: JSON.stringify(chunkList),
    logsJson: JSON.stringify(logs),
    usageJson: JSON.stringify({ totalPromptTokens, totalCompletionTokens }),
  });
}

/** Called from the function's onFailure — marks the job/chapter errored for the UI. */
export async function failJob(jobId: string, message: string): Promise<void> {
  log("error", "step transition", { jobId, step: "fail", message });
  const row = await loadJob(jobId);
  if (!row) return;
  const { job, chapter } = row;
  if (job.status !== "running" && job.status !== "pending") return; // cancelled/done elsewhere

  const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
  logs.push(createLog("error", `Job failed: ${message}`));

  await saveJob(job.id, { status: "error", error: message, logsJson: JSON.stringify(logs) });
  await db
    .update(chapters)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(chapters.id, chapter.id));
}
