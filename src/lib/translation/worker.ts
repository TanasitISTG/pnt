import "@tanstack/react-start/server-only";
import { eq, and, sql, lt, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { createProviderClient, ProviderNotConfiguredError } from "./provider-client";
import { buildSystemPrompt, buildSummaryPrompt } from "./prompts";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";
import { buildTermSuggestionPrompt, parseTermSuggestions } from "./suggest-terms-prompt";
import { createLog, type ChunkProgress, type LogEntry } from "./translation.functions";

// ponytail: lease must outlive the slowest possible single LLM call (observed: ~9.2 min/chunk).
// Crash mid-chunk -> lease expires -> next cron run resumes. Lower this if chunks get faster.
const LEASE = sql`now() + interval '15 minutes'`;

async function releaseLeaseAndFail(jobId: string, chapterId: string, message: string) {
  await db
    .update(translationJobs)
    .set({ status: "error", error: message, lockedUntil: null, updatedAt: new Date() })
    .where(eq(translationJobs.id, jobId));
  await db
    .update(chapters)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
}

/**
 * Processes one unit of work for a job: one chunk, or finalization when all
 * chunks are done. Safe against concurrent invocations via an atomic DB lease.
 */
export async function processJobOnce(jobId: string): Promise<{ status: string }> {
  // Atomic lease claim — 0 rows means another worker holds it (or job is terminal).
  const claimed = await db
    .update(translationJobs)
    .set({ lockedUntil: LEASE, updatedAt: new Date() })
    .where(
      and(
        eq(translationJobs.id, jobId),
        sql`${translationJobs.status} IN ('pending', 'running')`,
        sql`(${translationJobs.lockedUntil} IS NULL OR ${translationJobs.lockedUntil} < now())`,
      ),
    )
    .returning({ id: translationJobs.id });

  if (claimed.length === 0) {
    return { status: "skipped" };
  }

  const [row] = await db
    .select({
      job: translationJobs,
      chapter: chapters,
      novel: novels,
    })
    .from(translationJobs)
    .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(translationJobs.id, jobId))
    .limit(1);

  if (!row) {
    return { status: "missing" };
  }

  const { job, chapter, novel } = row;

  let providerConfig;
  try {
    providerConfig = await createProviderClient(novel.userId);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      await releaseLeaseAndFail(job.id, chapter.id, err.message);
      return { status: "error" };
    }
    throw err;
  }

  const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
  const chunkList: ChunkProgress[] = JSON.parse(job.chunksJson || "[]");

  // Set job to running & chapter to translating
  if (job.status !== "running") {
    await db
      .update(translationJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(translationJobs.id, job.id));

    await db
      .update(chapters)
      .set({ status: "translating", updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));
  }

  let doneChunks = job.doneChunks;

  // Fetch all approved glossary terms for the novel
  const terms = await db
    .select({
      source: glossaryTerms.source,
      target: glossaryTerms.target,
      category: glossaryTerms.category,
    })
    .from(glossaryTerms)
    .where(and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.status, "approved")));

  // Fetch previous chapter summary for rolling context
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

  const previousSummary = prevChapter?.summary || null;
  const tailLen = novel.contextTailLength || 500;

  // Process 1 chunk per run so a single invocation stays within function limits
  if (doneChunks < chunkList.length) {
    const i = doneChunks;
    const currentChunk = chunkList[i];

    logs.push(
      createLog(
        "info",
        `Translating chunk ${i + 1}/${chunkList.length} (${currentChunk.text.length.toLocaleString()} chars)...`,
      ),
    );

    // Determine previous chunk tail
    let previousChunkTail: string | null = null;
    if (i > 0 && chunkList[i - 1]?.translation) {
      previousChunkTail = chunkList[i - 1].translation!.slice(-tailLen);
    } else if (i === 0 && prevChapter?.translatedContent) {
      previousChunkTail = prevChapter.translatedContent.slice(-tailLen);
    }

    // Filter glossary terms for current chunk
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

    // Assemble system prompt
    const systemPrompt = buildSystemPrompt(
      `${novel.sourceLang}->${novel.targetLang}`,
      glossaryBlock,
      { previousSummary, previousChunkTail },
      novel.customPrompt,
    );

    // Provider API call with timing & retries
    let translation: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let lastErr: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const completion = await providerConfig.client.chat.completions.create({
          model: providerConfig.model,
          temperature: providerConfig.temperature,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: currentChunk.text },
          ],
        });

        translation = completion.choices[0]?.message?.content || "";
        promptTokens = completion.usage?.prompt_tokens || 0;
        completionTokens = completion.usage?.completion_tokens || 0;
        break;
      } catch (err: any) {
        lastErr = err;
        logs.push(
          createLog(
            "warn",
            `Chunk ${i + 1}/${chunkList.length} attempt ${attempt} failed: ${err.message || "API Error"}`,
          ),
        );
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    const elapsedMs = Date.now() - startTime;

    if (translation === null) {
      const errorMsg = lastErr?.message || "Translation API call failed after 3 retries";
      currentChunk.error = errorMsg;
      chunkList[i] = currentChunk;
      logs.push(createLog("error", `Chunk ${i + 1}/${chunkList.length} failed: ${errorMsg}`));

      await db
        .update(translationJobs)
        .set({
          status: "error",
          error: errorMsg,
          chunksJson: JSON.stringify(chunkList),
          logsJson: JSON.stringify(logs),
          doneChunks,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(translationJobs.id, job.id));

      await db
        .update(chapters)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(chapters.id, chapter.id));

      return { status: "error" };
    }

    currentChunk.translation = translation;
    currentChunk.promptTokens = promptTokens;
    currentChunk.completionTokens = completionTokens;
    currentChunk.latencyMs = elapsedMs;
    chunkList[i] = currentChunk;
    doneChunks++;

    logs.push(
      createLog(
        "success",
        `Chunk ${i + 1}/${chunkList.length} completed in ${(elapsedMs / 1000).toFixed(1)}s (tokens: ${promptTokens} prompt + ${completionTokens} completion).`,
      ),
    );

    // Save interim progress after chunk (releases the lease)
    await db
      .update(translationJobs)
      .set({
        doneChunks,
        chunksJson: JSON.stringify(chunkList),
        logsJson: JSON.stringify(logs),
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationJobs.id, job.id));
  }

  // Check if job completed
  if (doneChunks === chunkList.length) {
    // Claim finalization atomically — even with the lease, belt and suspenders:
    // only one worker may ever run summary + glossary extraction.
    const finalized = await db
      .update(translationJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(
        and(
          eq(translationJobs.id, job.id),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      )
      .returning({ id: translationJobs.id });

    if (finalized.length === 0) {
      return { status: "skipped" };
    }

    logs.push(createLog("info", "All chunks translated. Assembling chapter..."));

    const fullTranslation = chunkList.map((c) => c.translation || "").join("\n\n");
    const totalPromptTokens = chunkList.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
    const totalCompletionTokens = chunkList.reduce((acc, c) => acc + (c.completionTokens || 0), 0);

    // Persist the chapter up front: the claim above already marks the job 'done',
    // so any client observing it must see the translation.
    await db
      .update(chapters)
      .set({
        translatedContent: fullTranslation,
        status: "translated",
        translatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, chapter.id));

    // Generate chapter summary in English
    let summaryText: string | null = null;
    logs.push(createLog("info", "Generating English chapter summary..."));
    await db
      .update(translationJobs)
      .set({ logsJson: JSON.stringify(logs), updatedAt: new Date() })
      .where(eq(translationJobs.id, job.id));

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
      summaryText = summaryCompletion.choices[0]?.message?.content || null;
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

    // Auto-suggest glossary terms (v1.1)
    logs.push(createLog("info", "Extracting new glossary term suggestions..."));
    await db
      .update(translationJobs)
      .set({ logsJson: JSON.stringify(logs), updatedAt: new Date() })
      .where(eq(translationJobs.id, job.id));
    try {
      const existingSources = terms.map((t) => t.source);
      const suggestPrompt = buildTermSuggestionPrompt(
        `${novel.sourceLang}->${novel.targetLang}`,
        existingSources,
      );

      let suggestionContent = "";
      try {
        // Attempt structured JSON output first
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
        // Fallback to standard output without response_format
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
        // Check if already in DB (approved or pending)
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
          createLog(
            "success",
            `Extracted ${addedCount} pending term suggestion(s) for user review.`,
          ),
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

    await db
      .update(translationJobs)
      .set({
        status: "done",
        doneChunks,
        chunksJson: JSON.stringify(chunkList),
        logsJson: JSON.stringify(logs),
        usageJson: JSON.stringify({ totalPromptTokens, totalCompletionTokens }),
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(translationJobs.id, job.id));

    return { status: "done" };
  }

  return { status: "running" };
}

/**
 * One cron run: process one chunk (or finalization) for every claimable job.
 * Overlapping runs are harmless — the lease claim skips held jobs.
 */
export async function runTranslationWorker() {
  const dueJobs = await db
    .select({ id: translationJobs.id })
    .from(translationJobs)
    .where(
      and(
        sql`${translationJobs.status} IN ('pending', 'running')`,
        sql`(${translationJobs.lockedUntil} IS NULL OR ${translationJobs.lockedUntil} < now())`,
      ),
    );

  const results: { jobId: string; status: string; error?: string }[] = [];
  for (const j of dueJobs) {
    try {
      const res = await processJobOnce(j.id);
      results.push({ jobId: j.id, status: res.status });
    } catch (err: any) {
      // Lease stays held; it expires and a later run resumes the job.
      results.push({ jobId: j.id, status: "error", error: err?.message || "Worker error" });
    }
  }

  return { processed: results.length, results };
}
