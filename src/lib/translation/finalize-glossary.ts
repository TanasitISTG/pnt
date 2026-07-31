import "@tanstack/react-start/server-only";

import type { novels, chapters, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { loadTermSourcesForExclusion, findExistingTermSources } from "./job-store";
import { createLog } from "./log-entry";
import type { AIProviderClient, ChatMessage, ChunkProgress, LogEntry } from "./translation.types";
import {
  buildTermSuggestionPrompt,
  buildTermSuggestionUserMessage,
  parseTermSuggestions,
  buildGlossaryReviewPrompt,
  parseGlossaryReviewResponse,
} from "./suggest-terms-prompt";

export interface FinalizeGlossaryParams {
  providerConfig: AIProviderClient;
  novel: typeof novels.$inferSelect;
  chapter: typeof chapters.$inferSelect;
  chunkList: ChunkProgress[];
  fullTranslation: string;
  freshSummary?: string;
  logs: LogEntry[];
}

export interface FinalizeGlossaryResult {
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  conflictCount: number;
  promptTokens: number;
  completionTokens: number;
  rowsToInsert: (typeof glossaryTerms.$inferInsert)[];
}

async function generateJsonWithFallback(
  providerConfig: AIProviderClient,
  temperature: number,
  messages: ChatMessage[],
) {
  try {
    const res = await providerConfig.generateChatCompletion({
      temperature,
      model: providerConfig.fastModel ?? undefined,
      messages,
      responseFormat: { type: "json_object" },
    });
    return {
      content: res.content || "",
      promptTokens: res.usage?.promptTokens || 0,
      completionTokens: res.usage?.completionTokens || 0,
    };
  } catch {
    const res = await providerConfig.generateChatCompletion({
      temperature,
      model: providerConfig.fastModel ?? undefined,
      messages,
    });
    return {
      content: res.content || "",
      promptTokens: res.usage?.promptTokens || 0,
      completionTokens: res.usage?.completionTokens || 0,
    };
  }
}

export async function suggestAndReviewTerms({
  providerConfig,
  novel,
  chapter,
  chunkList,
  fullTranslation,
  freshSummary,
  logs,
}: FinalizeGlossaryParams): Promise<FinalizeGlossaryResult> {
  let promptTokens = 0;
  let completionTokens = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let conflictCount = 0;
  let rowsToInsert: (typeof glossaryTerms.$inferInsert)[] = [];

  logs.push(createLog("info", "Extracting new glossary term suggestions..."));

  try {
    const { approvedTerms, rejectedTerms } = await loadTermSourcesForExclusion(novel.id);

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

    const suggestResult = await generateJsonWithFallback(providerConfig, 0.3, [
      { role: "system", content: suggestPrompt },
      { role: "user", content: userMessage },
    ]);
    promptTokens += suggestResult.promptTokens;
    completionTokens += suggestResult.completionTokens;

    const suggestedTerms = parseTermSuggestions(suggestResult.content);

    // AI review of extracted terms
    let reviewResults: Awaited<ReturnType<typeof parseGlossaryReviewResponse>> = [];
    if (suggestedTerms.length > 0) {
      logs.push(
        createLog("info", `Reviewing ${suggestedTerms.length} suggested term(s) with AI...`),
      );

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

        const reviewResult = await generateJsonWithFallback(providerConfig, 0.1, [
          { role: "system", content: reviewPrompt },
          { role: "user", content: reviewUserMessage },
        ]);
        promptTokens += reviewResult.promptTokens;
        completionTokens += reviewResult.completionTokens;

        reviewResults = parseGlossaryReviewResponse(reviewResult.content);
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

    const suggestedSources = suggestedTerms.map((st) => st.source.trim().toLowerCase());
    const existingSources = await findExistingTermSources(novel.id, suggestedSources);

    rowsToInsert = [];

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

      if (existingSources.has(st.source.trim().toLowerCase())) {
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
      const approved =
        review?.action === "approve" &&
        review.confidence === "high" &&
        sourceInRaw &&
        targetInTranslation;

      rowsToInsert.push({
        id: nanoid(),
        novelId: novel.id,
        source: st.source,
        target: finalTarget,
        category: st.category,
        note: st.note || null,
        status: approved ? "approved" : "pending",
      });
      if (approved) approvedCount++;
      else pendingCount++;
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

  return {
    approvedCount,
    pendingCount,
    rejectedCount,
    conflictCount,
    promptTokens,
    completionTokens,
    rowsToInsert,
  };
}
