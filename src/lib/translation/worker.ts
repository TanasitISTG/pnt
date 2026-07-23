import "@tanstack/react-start/server-only";
import { eq, and, sql, lt, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "./provider-client";
import { buildSystemPrompt, buildSummaryPrompt, findResidualSourceChars } from "./prompts";
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
import { createLog, type ChunkProgress, type LogEntry } from "./translation.functions";
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

  const previousSummary = prevChapter?.summary || null;
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
    { previousSummary, previousChunkTail },
    novel.customPrompt,
  );

  const startTime = Date.now();
  let completion;
  const markedText = injectParagraphMarkers(currentChunk.text);
  const expectedMarkers = countParagraphMarkers(markedText);
  try {
    completion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: providerConfig.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: markedText },
      ],
    });
  } catch (err: any) {
    // Record which chunk failed for the UI, then rethrow — Inngest owns retries.
    currentChunk.error = err?.message || "API Error";
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
  let translation = completion.choices[0]?.message?.content || "";

  if (!translation.trim()) {
    currentChunk.error = "Empty completion";
    chunkList[i] = currentChunk;
    logs.push(
      createLog("warn", `Chunk ${i + 1}/${chunkList.length} failed: ${currentChunk.error}`),
    );
    await saveJob(job.id, {
      chunksJson: JSON.stringify(chunkList),
      logsJson: JSON.stringify(logs),
    });
    throw new Error("Empty completion");
  }

  let promptTokens = completion.usage?.prompt_tokens || 0;
  let completionTokens = completion.usage?.completion_tokens || 0;

  // Restore paragraph markers and check count
  const receivedMarkers = countParagraphMarkers(translation);
  if (receivedMarkers !== expectedMarkers && expectedMarkers > 0) {
    // One corrective request for marker count mismatch
    try {
      const markerFix = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: providerConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: markedText },
          { role: "assistant", content: translation },
          {
            role: "user",
            content: `Your translation has ${receivedMarkers} ||¶|| markers but the source has ${expectedMarkers}. Re-output the COMPLETE translation preserving every ||¶|| marker exactly as-is in the correct positions. Output only the corrected translation.`,
          },
        ],
      });
      promptTokens += markerFix.usage?.prompt_tokens || 0;
      completionTokens += markerFix.usage?.completion_tokens || 0;
      const fixed = markerFix.choices[0]?.message?.content || "";
      const fixedMarkers = countParagraphMarkers(fixed);
      if (fixed.trim() && fixedMarkers === expectedMarkers) {
        translation = fixed;
        logs.push(
          createLog("success", `Chunk ${i + 1}/${chunkList.length} marker count corrected.`),
        );
      } else if (fixed.trim()) {
        logs.push(
          createLog(
            "warn",
            `Chunk ${i + 1}/${chunkList.length} marker fix didn't match (${fixedMarkers}/${expectedMarkers}) — keeping original.`,
          ),
        );
      }
    } catch (markerFixErr: any) {
      logs.push(
        createLog(
          "warn",
          `Chunk ${i + 1}/${chunkList.length} marker fix failed (${markerFixErr?.message || "error"}) — keeping original.`,
        ),
      );
    }
  }

  translation = restoreParagraphMarkers(translation);

  // Guard: fast models sometimes leave hanzi behind (gift/system lines, usernames).
  // One corrective round-trip, then accept whatever comes back. >2 tolerates a
  // stray deliberate glyph; a skipped line trips it easily.
  const pair = `${novel.sourceLang}->${novel.targetLang}`;
  const residual = findResidualSourceChars(pair, translation);
  if (residual.length > 2) {
    logs.push(
      createLog(
        "warn",
        `Chunk ${i + 1}/${chunkList.length} has ${residual.length} untranslated hanzi — re-requesting.`,
      ),
    );
    try {
      const fix = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: providerConfig.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: markedText },
          { role: "assistant", content: translation },
          {
            role: "user",
            content:
              "Your translation still contains untranslated Chinese text. Re-output the COMPLETE translation with every Chinese word translated or transliterated — including bracketed lines, notifications, and all names. Preserve every ||¶|| marker exactly. Output only the corrected translation.",
          },
        ],
      });
      promptTokens += fix.usage?.prompt_tokens || 0;
      completionTokens += fix.usage?.completion_tokens || 0;
      const fixed = fix.choices[0]?.message?.content || "";
      if (fixed.trim()) {
        translation = restoreParagraphMarkers(fixed);
        const left = findResidualSourceChars(pair, fixed).length;
        logs.push(
          createLog(
            left > 2 ? "warn" : "success",
            left > 2
              ? `Chunk ${i + 1}/${chunkList.length} still has ${left} hanzi after retry — keeping anyway.`
              : `Chunk ${i + 1}/${chunkList.length} re-translated cleanly.`,
          ),
        );
      }
    } catch (fixErr: any) {
      logs.push(
        createLog(
          "warn",
          `Chunk ${i + 1}/${chunkList.length} re-translation failed (${fixErr?.message || "error"}) — keeping original.`,
        ),
      );
    }
  }

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
    const summaryCompletion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: providerConfig.temperature,
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
    totalPromptTokens += summaryCompletion.usage?.prompt_tokens || 0;
    totalCompletionTokens += summaryCompletion.usage?.completion_tokens || 0;
    freshSummary = summaryCompletion.choices[0]?.message?.content || null;
    const summaryTime = ((Date.now() - summaryStartTime) / 1000).toFixed(1);
    logs.push(createLog("success", `Summary generated in ${summaryTime}s.`));

    if (freshSummary) {
      await db
        .update(chapters)
        .set({ summary: freshSummary, updatedAt: new Date() })
        .where(eq(chapters.id, chapter.id));
    }
  } catch (sumErr: any) {
    logs.push(createLog("warn", `Summary generation skipped: ${sumErr.message || "Failed"}`));
  }

  // Auto-suggest glossary terms with AI review
  logs.push(createLog("info", "Extracting new glossary term suggestions..."));
  await saveJob(job.id, { logsJson: JSON.stringify(logs) });
  try {
    const approvedTerms = await db
      .select({ source: glossaryTerms.source, target: glossaryTerms.target })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));

    const fullRawSource = chunkList.map((c) => c.text || "").join("\n\n");
    const rawSourceExcerpt = fullRawSource.slice(0, 4000);
    const translatedExcerpt = fullTranslation.slice(0, 8000);

    const effectiveSummary = freshSummary || chapter.summary || undefined;
    const suggestPrompt = buildTermSuggestionPrompt(
      `${novel.sourceLang}->${novel.targetLang}`,
      approvedTerms.map((t) => t.source),
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
      const suggestCompletion = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: suggestPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
      });
      totalPromptTokens += suggestCompletion.usage?.prompt_tokens || 0;
      totalCompletionTokens += suggestCompletion.usage?.completion_tokens || 0;
      suggestionContent = suggestCompletion.choices[0]?.message?.content || "";
    } catch {
      const suggestCompletion = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: suggestPrompt },
          { role: "user", content: userMessage },
        ],
      });
      totalPromptTokens += suggestCompletion.usage?.prompt_tokens || 0;
      totalCompletionTokens += suggestCompletion.usage?.completion_tokens || 0;
      suggestionContent = suggestCompletion.choices[0]?.message?.content || "";
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
          const reviewCompletion = await providerConfig.client.chat.completions.create({
            model: providerConfig.model,
            temperature: 0.1,
            messages: [
              { role: "system", content: reviewPrompt },
              { role: "user", content: reviewUserMessage },
            ],
            response_format: { type: "json_object" },
          });
          totalPromptTokens += reviewCompletion.usage?.prompt_tokens || 0;
          totalCompletionTokens += reviewCompletion.usage?.completion_tokens || 0;
          reviewContent = reviewCompletion.choices[0]?.message?.content || "";
        } catch {
          const reviewCompletion = await providerConfig.client.chat.completions.create({
            model: providerConfig.model,
            temperature: 0.1,
            messages: [
              { role: "system", content: reviewPrompt },
              { role: "user", content: reviewUserMessage },
            ],
          });
          totalPromptTokens += reviewCompletion.usage?.prompt_tokens || 0;
          totalCompletionTokens += reviewCompletion.usage?.completion_tokens || 0;
          reviewContent = reviewCompletion.choices[0]?.message?.content || "";
        }

        reviewResults = parseGlossaryReviewResponse(reviewContent);
      } catch (reviewErr: any) {
        logs.push(
          createLog(
            "warn",
            `AI review failed (${reviewErr?.message || "error"}) — all terms stored as pending.`,
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
        .select({ id: glossaryTerms.id, status: glossaryTerms.status })
        .from(glossaryTerms)
        .where(
          and(
            eq(glossaryTerms.novelId, novel.id),
            sql`lower(trim(${glossaryTerms.source})) = lower(trim(${st.source}))`,
          ),
        )
        .limit(1);

      if (dup) {
        // Never modify existing approved terms
        if (dup.status === "approved") {
          conflictCount++;
          continue;
        }
        // Duplicate pending term — skip
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
  } catch (sugErr: any) {
    logs.push(createLog("warn", `Term auto-suggest skipped: ${sugErr.message || "Failed"}`));
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
