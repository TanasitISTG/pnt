import "@tanstack/react-start/server-only";
import { eq, and, sql, lt, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "./provider-client";
import { buildSystemPrompt, buildSummaryPrompt, findResidualSourceChars } from "./prompts";
import { translateChapterTitle } from "./title";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";
import { buildTermSuggestionPrompt, parseTermSuggestions } from "./suggest-terms-prompt";
import { createLog, type ChunkProgress, type LogEntry } from "./translation.functions";

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
  try {
    completion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: providerConfig.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: currentChunk.text },
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
  let promptTokens = completion.usage?.prompt_tokens || 0;
  let completionTokens = completion.usage?.completion_tokens || 0;

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
          { role: "user", content: currentChunk.text },
          { role: "assistant", content: translation },
          {
            role: "user",
            content:
              "Your translation still contains untranslated Chinese text. Re-output the COMPLETE translation with every Chinese word translated or transliterated — including bracketed lines, notifications, and all names. Output only the corrected translation.",
          },
        ],
      });
      promptTokens += fix.usage?.prompt_tokens || 0;
      completionTokens += fix.usage?.completion_tokens || 0;
      const fixed = fix.choices[0]?.message?.content || "";
      if (fixed.trim()) {
        translation = fixed;
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

  const fullTranslation = chunkList.map((c) => c.translation || "").join("\n\n");
  const totalPromptTokens = chunkList.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
  const totalCompletionTokens = chunkList.reduce((acc, c) => acc + (c.completionTokens || 0), 0);

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
  const translatedTitle = await translateChapterTitle(
    providerConfig,
    `${novel.sourceLang}->${novel.targetLang}`,
    chapter.title,
  );
  if (translatedTitle) {
    await db
      .update(chapters)
      .set({ translatedTitle, updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));
    logs.push(createLog("success", `Title translated: "${translatedTitle}"`));
  } else {
    logs.push(createLog("warn", "Title translation skipped — keeping raw title."));
  }

  // Generate chapter summary in English
  logs.push(createLog("info", "Generating English chapter summary..."));
  await saveJob(job.id, { logsJson: JSON.stringify(logs) });
  const summaryStartTime = Date.now();

  try {
    const summarySystemPrompt = buildSummaryPrompt(`${novel.sourceLang}->${novel.targetLang}`);
    const summaryCompletion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: providerConfig.temperature,
      messages: [
        { role: "system", content: summarySystemPrompt },
        {
          role: "user",
          content: `Please summarize this chapter:\n\n${fullTranslation.slice(0, 10000)}`,
        },
      ],
    });
    const summaryText = summaryCompletion.choices[0]?.message?.content || null;
    const summaryTime = ((Date.now() - summaryStartTime) / 1000).toFixed(1);
    logs.push(createLog("success", `Summary generated in ${summaryTime}s.`));

    if (summaryText) {
      await db
        .update(chapters)
        .set({ summary: summaryText, updatedAt: new Date() })
        .where(eq(chapters.id, chapter.id));
    }
  } catch (sumErr: any) {
    logs.push(createLog("warn", `Summary generation skipped: ${sumErr.message || "Failed"}`));
  }

  // Auto-suggest glossary terms
  logs.push(createLog("info", "Extracting new glossary term suggestions..."));
  await saveJob(job.id, { logsJson: JSON.stringify(logs) });
  try {
    const approvedTerms = await db
      .select({ source: glossaryTerms.source })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));
    const suggestPrompt = buildTermSuggestionPrompt(
      `${novel.sourceLang}->${novel.targetLang}`,
      approvedTerms.map((t) => t.source),
    );

    let suggestionContent = "";
    try {
      const suggestCompletion = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: suggestPrompt },
          {
            role: "user",
            content: `Extract glossary terms from this chapter excerpt:\n\n${fullTranslation.slice(0, 8000)}`,
          },
        ],
        response_format: { type: "json_object" },
      });
      suggestionContent = suggestCompletion.choices[0]?.message?.content || "";
    } catch {
      const suggestCompletion = await providerConfig.client.chat.completions.create({
        model: providerConfig.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: suggestPrompt },
          {
            role: "user",
            content: `Extract glossary terms from this chapter excerpt:\n\n${fullTranslation.slice(0, 8000)}`,
          },
        ],
      });
      suggestionContent = suggestCompletion.choices[0]?.message?.content || "";
    }

    const suggestedTerms = parseTermSuggestions(suggestionContent);
    let addedCount = 0;

    for (const st of suggestedTerms) {
      const [dup] = await db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.source, st.source)))
        .limit(1);

      if (!dup) {
        await db.insert(glossaryTerms).values({
          id: nanoid(),
          novelId: novel.id,
          source: st.source,
          target: st.target,
          category: st.category,
          note: st.note || null,
          status: "pending",
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      logs.push(
        createLog("success", `Extracted ${addedCount} pending term suggestion(s) for user review.`),
      );
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
