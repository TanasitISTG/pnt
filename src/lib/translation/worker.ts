import "@tanstack/react-start/server-only";

import { createProviderClient } from "./provider-client";
import type { AIProviderClient } from "./translation.types";
import { splitAtParagraphBoundary } from "./chunker";
import { buildSystemPrompt, buildUserMessage, findResidualSourceChars } from "./prompts";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";
import {
  injectParagraphMarkers,
  restoreParagraphMarkers,
  countParagraphMarkers,
  normalizeTranslationOutput,
} from "./paragraphs";
import { extractHanziSpans, spliceSpans } from "./residual-repair";
import { createLog } from "./log-entry";
import type { ChunkProgress, LogEntry, SlimChunkProgress } from "./translation.types";
import { log } from "@/lib/log";
import {
  beginJob,
  completeJob,
  failActiveJob,
  loadJob,
  loadApprovedTermsForContext,
  loadPrevChapterForContext,
  saveJobProgress,
} from "./job-store";
import { canRunJob, isCompletedChunk, isNextChunk } from "./job-state";
import { generateSummaryArtifacts } from "./finalize-summary";
import { suggestAndReviewTerms } from "./finalize-glossary";

// Execution is driven by Inngest (see src/lib/inngest/functions.ts): one event
// per job, each chunk a memoized step with its own invocation + retries — so no
// lease, no cron pinger. DB status rows stay the UI's source of truth.

export async function initJob(jobId: string, generation: number) {
  log("info", "step transition", { jobId, step: "init" });
  const row = await beginJob(jobId, generation);
  if (!row) {
    return { skip: true as const, doneChunks: 0, totalChunks: 0 };
  }
  const { job } = row;
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
  if (initial.length === 0) return { translation: text, promptTokens, completionTokens };
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
  const stillDirty = findResidualSourceChars(langPair, text).length > 0;
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
            left > 0 ? "warn" : "success",
            left > 0
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

export async function translateChunk(jobId: string, i: number, generation: number): Promise<void> {
  log("info", "step transition", { jobId, step: "translateChunk", chunk: i });
  const row = await loadJob(jobId);
  if (!row) throw new Error(`Job ${jobId} not found`);
  const { job, chapter, novel } = row;

  if (job.status !== "running" || !canRunJob(job, chapter, generation)) return;
  if (isCompletedChunk(job, i)) return;
  if (!isNextChunk(job, i)) throw new Error(`Chunk ${i} is out of sequence for job ${jobId}`);

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

  // Approved glossary terms + previous chapter for rolling context —
  // independent reads, run them concurrently.
  const [terms, prevChapter] = await Promise.all([
    loadApprovedTermsForContext(novel.id),
    loadPrevChapterForContext(novel.id, chapter.number),
  ]);

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
    const saved = await saveJobProgress(job.id, generation, i, {
      chunksJson: JSON.stringify(chunkList),
      logsJson: JSON.stringify(logs),
    });
    if (!saved) return;
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

  await saveJobProgress(job.id, generation, i, {
    doneChunks: i + 1,
    chunksJson: JSON.stringify(chunkList),
    logsJson: JSON.stringify(logs),
  });
}

// Done jobs are not retryable (retryTranslationJob only accepts error/cancelled),
// so drop the full source/translated payloads — 2× chapter text per job row —
// and keep display metadata. Cancelled/errored jobs keep payloads: retry resumes
// from chunksJson. UI reads the slim shape via getTranslationJobStatus.
// ponytail: superseded cancelled jobs still retain payloads — delete-on-supersede
// deferred (an in-flight run of a deleted row throws instead of exiting cleanly).
function stripChunkPayloads(chunkList: ChunkProgress[]): SlimChunkProgress[] {
  return chunkList.map((c) => ({
    index: c.index,
    textLength: c.text?.length ?? 0,
    hasTranslation: !!c.translation,
    promptTokens: c.promptTokens,
    completionTokens: c.completionTokens,
    latencyMs: c.latencyMs,
    ...(c.error ? { error: c.error } : {}),
  }));
}

export async function finalizeJob(jobId: string, generation: number): Promise<void> {
  log("info", "step transition", { jobId, step: "finalize" });
  const row = await loadJob(jobId);
  if (!row) throw new Error(`Job ${jobId} not found`);
  const { job, chapter, novel } = row;

  if (job.status !== "running" || !canRunJob(job, chapter, generation)) return;

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

  // Phase 1: Summary & title generation
  const summaryRes = await generateSummaryArtifacts({
    providerConfig,
    novel,
    chapter,
    fullTranslation,
    logs,
  });
  totalPromptTokens += summaryRes.promptTokens;
  totalCompletionTokens += summaryRes.completionTokens;

  // Phase 2: Glossary term extraction & review
  const glossaryRes = await suggestAndReviewTerms({
    providerConfig,
    novel,
    chapter,
    chunkList,
    fullTranslation,
    freshSummary: summaryRes.freshSummary,
    logs,
  });
  totalPromptTokens += glossaryRes.promptTokens;
  totalCompletionTokens += glossaryRes.completionTokens;

  logs.push(
    createLog(
      "success",
      `Job completed! Total tokens: ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} prompt + ${totalCompletionTokens} completion).`,
    ),
  );

  await completeJob({
    jobId: job.id,
    generation,
    fullTranslation,
    translatedTitle: summaryRes.translatedTitle,
    chapterSummary: summaryRes.freshSummary,
    storySummary: summaryRes.updatedStorySummary,
    glossaryRows: glossaryRes.rowsToInsert,
    chunksJson: JSON.stringify(stripChunkPayloads(chunkList)),
    logsJson: JSON.stringify(logs),
    usageJson: JSON.stringify({ totalPromptTokens, totalCompletionTokens }),
  });
}

/** Called from the function's onFailure — marks the job/chapter errored for the UI. */
export async function failJob(jobId: string, generation: number, message: string): Promise<void> {
  log("error", "step transition", { jobId, step: "fail", message });
  const row = await loadJob(jobId);
  if (!row) return;
  const { job } = row;

  const logs: LogEntry[] = JSON.parse(job.logsJson || "[]");
  logs.push(createLog("error", `Job failed: ${message}`));

  await failActiveJob(job.id, generation, message, JSON.stringify(logs));
}
