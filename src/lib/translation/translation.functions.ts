import { createServerFn } from "@tanstack/react-start";
import { eq, and, sql, lt, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters, translationJobs, glossaryTerms } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";
import { nanoid } from "@/lib/utils";
import { createProviderClient } from "@/lib/translation/provider-client";
import { chunkText } from "@/lib/translation/chunker";
import { buildSystemPrompt, buildSummaryPrompt } from "@/lib/translation/prompts";
import { filterGlossaryForChunk, formatGlossaryBlock } from "@/lib/translation/glossary";
import {
  buildTermSuggestionPrompt,
  parseTermSuggestions,
} from "@/lib/translation/suggest-terms-prompt";
import {
  startTranslationJobSchema,
  tickTranslationJobSchema,
  cancelTranslationJobSchema,
  retryTranslationJobSchema,
  getJobStatusSchema,
} from "@/lib/translation/translation.schemas";

export interface ChunkProgress {
  index: number;
  text: string;
  translation?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

function createLog(level: LogEntry["level"], message: string): LogEntry {
  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  return { timestamp: time, level, message };
}

export const startTranslationJob = createServerFn({ method: "POST" })
  .validator(startTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    // Verify provider is configured
    const providerConfig = await createProviderClient(session.user.id);

    // Verify chapter ownership & load novel settings
    const [row] = await db
      .select({
        chapter: chapters,
        novel: novels,
      })
      .from(chapters)
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(chapters.id, data.chapterId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Chapter not found or unauthorized");
    }

    const { chapter, novel } = row;

    // Split text into chunks
    const chunkInfos = chunkText(chapter.rawContent, novel.chunkSize || 2000);
    if (chunkInfos.length === 0) {
      throw new Error("Chapter content is empty");
    }

    // Cancel any existing active jobs for this chapter
    const existingJobs = await db
      .select({ id: translationJobs.id })
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.chapterId, chapter.id),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      );

    for (const j of existingJobs) {
      await db
        .update(translationJobs)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(translationJobs.id, j.id));
    }

    const initialChunks: ChunkProgress[] = chunkInfos.map((c) => ({
      index: c.index,
      text: c.text,
    }));

    const logs: LogEntry[] = [
      createLog(
        "info",
        `Job initialized for Chapter "${chapter.title}" (${chapter.rawCharCount.toLocaleString()} chars).`,
      ),
      createLog(
        "info",
        `Split into ${chunkInfos.length} chunk(s) (target size: ${(novel.chunkSize || 2000).toLocaleString()} chars). Model: ${providerConfig.model}`,
      ),
    ];

    const jobId = nanoid();

    await db.insert(translationJobs).values({
      id: jobId,
      chapterId: chapter.id,
      status: "pending",
      totalChunks: chunkInfos.length,
      doneChunks: 0,
      chunksJson: JSON.stringify(initialChunks),
      logsJson: JSON.stringify(logs),
    });

    await db
      .update(chapters)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(chapters.id, chapter.id));

    return { jobId, totalChunks: chunkInfos.length, logs };
  });

export const tickTranslationJob = createServerFn({ method: "POST" })
  .validator(tickTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();
    const providerConfig = await createProviderClient(session.user.id);

    // Load job details along with chapter & novel
    const [row] = await db
      .select({
        job: translationJobs,
        chapter: chapters,
        novel: novels,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Translation job not found or unauthorized");
    }

    const { job, chapter, novel } = row;

    const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
    const chunkList: ChunkProgress[] = JSON.parse(job.chunksJson || "[]");

    if (job.status === "done" || job.status === "cancelled") {
      return {
        status: job.status,
        doneChunks: job.doneChunks,
        totalChunks: job.totalChunks,
        error: job.error,
        logs,
        model: providerConfig.model,
      };
    }

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

    // Process 1 chunk per tick to give immediate UI updates and avoid timeouts
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
            updatedAt: new Date(),
          })
          .where(eq(translationJobs.id, job.id));

        await db
          .update(chapters)
          .set({ status: "error", updatedAt: new Date() })
          .where(eq(chapters.id, chapter.id));

        return {
          status: "error",
          doneChunks,
          totalChunks: chunkList.length,
          error: errorMsg,
          logs,
          model: providerConfig.model,
        };
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
          `Chunk ${i}/${chunkList.length} completed in ${(elapsedMs / 1000).toFixed(1)}s (tokens: ${promptTokens} prompt + ${completionTokens} completion).`,
        ),
      );

      // Save interim progress after chunk
      await db
        .update(translationJobs)
        .set({
          doneChunks,
          chunksJson: JSON.stringify(chunkList),
          logsJson: JSON.stringify(logs),
          updatedAt: new Date(),
        })
        .where(eq(translationJobs.id, job.id));
    }

    // Check if job completed
    if (doneChunks === chunkList.length) {
      logs.push(createLog("info", "All chunks translated. Assembling chapter..."));

      const fullTranslation = chunkList.map((c) => c.translation || "").join("\n\n");
      const totalPromptTokens = chunkList.reduce((acc, c) => acc + (c.promptTokens || 0), 0);
      const totalCompletionTokens = chunkList.reduce(
        (acc, c) => acc + (c.completionTokens || 0),
        0,
      );

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
            .where(
              and(eq(glossaryTerms.novelId, novel.id), eq(glossaryTerms.source, st.source)),
            )
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
        logs.push(
          createLog("warn", `Term auto-suggest skipped: ${sugErr.message || "Failed"}`),
        );
      }

      logs.push(
        createLog(
          "success",
          `Job completed! Total tokens: ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} prompt + ${totalCompletionTokens} completion).`,
        ),
      );

      await db
        .update(chapters)
        .set({
          translatedContent: fullTranslation,
          status: "translated",
          summary: summaryText,
          translatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, chapter.id));

      await db
        .update(translationJobs)
        .set({
          status: "done",
          doneChunks,
          chunksJson: JSON.stringify(chunkList),
          logsJson: JSON.stringify(logs),
          usageJson: JSON.stringify({ totalPromptTokens, totalCompletionTokens }),
          updatedAt: new Date(),
        })
        .where(eq(translationJobs.id, job.id));

      return {
        status: "done",
        doneChunks,
        totalChunks: chunkList.length,
        logs,
        model: providerConfig.model,
      };
    }

    return {
      status: "running",
      doneChunks,
      totalChunks: chunkList.length,
      logs,
      model: providerConfig.model,
    };
  });

export const cancelTranslationJob = createServerFn({ method: "POST" })
  .validator(cancelTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({
        job: translationJobs,
        chapter: chapters,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Job not found or unauthorized");
    }

    const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
    logs.push(createLog("warn", "Job cancelled by user."));

    await db
      .update(translationJobs)
      .set({ status: "cancelled", logsJson: JSON.stringify(logs), updatedAt: new Date() })
      .where(eq(translationJobs.id, row.job.id));

    const newStatus = row.chapter.translatedContent ? "translated" : "raw";
    await db
      .update(chapters)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(chapters.id, row.chapter.id));

    return { success: true };
  });

export const retryTranslationJob = createServerFn({ method: "POST" })
  .validator(retryTranslationJobSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();

    const [row] = await db
      .select({
        job: translationJobs,
        chapter: chapters,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(eq(translationJobs.id, data.jobId), eq(novels.userId, session.user.id)))
      .limit(1);

    if (!row) {
      throw new Error("Job not found or unauthorized");
    }

    const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
    logs.push(createLog("info", "Job retry initiated. Resuming from last completed chunk..."));

    await db
      .update(translationJobs)
      .set({
        status: "pending",
        error: null,
        logsJson: JSON.stringify(logs),
        updatedAt: new Date(),
      })
      .where(eq(translationJobs.id, row.job.id));

    await db
      .update(chapters)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(chapters.id, row.chapter.id));

    return { success: true, jobId: row.job.id };
  });

export const getTranslationJobStatus = createServerFn({ method: "GET" })
  .validator(getJobStatusSchema)
  .handler(async ({ data }) => {
    const session = await ensureSession();
    const providerConfig = await createProviderClient(session.user.id).catch(() => null);

    const whereCondition = data.jobId
      ? eq(translationJobs.id, data.jobId)
      : data.chapterId
        ? eq(translationJobs.chapterId, data.chapterId)
        : null;

    if (!whereCondition) {
      return null;
    }

    const [row] = await db
      .select({ job: translationJobs, chapter: chapters })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(and(whereCondition, eq(novels.userId, session.user.id)))
      .orderBy(desc(translationJobs.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }

    const logs: LogEntry[] = JSON.parse(row.job.logsJson || "[]");
    const chunks: ChunkProgress[] = JSON.parse(row.job.chunksJson || "[]");

    return {
      id: row.job.id,
      chapterId: row.job.chapterId,
      chapterTitle: row.chapter.title,
      status: row.job.status,
      doneChunks: row.job.doneChunks,
      totalChunks: row.job.totalChunks,
      error: row.job.error,
      logs,
      chunks,
      usageJson: row.job.usageJson,
      model: providerConfig?.model || "AI Provider",
    };
  });
