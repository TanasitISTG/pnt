import "@tanstack/react-start/server-only";

import type { novels, glossaryTerms } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { createLog } from "./log-entry";
import { generateJsonCompletion } from "../providers/json-completion";
import { retryTranslationOperation } from "./retry";
import {
  applyGlossarySuggestionPolicy,
  prepareGlossarySuggestionCandidates,
  selectRelevantApprovedMappings,
} from "../glossary/policy";
import {
  buildGlossaryReviewPrompt,
  buildGlossaryReviewUserMessage,
  buildTermSuggestionPrompt,
  buildTermSuggestionUserMessage,
  parseGlossaryReviewResponse,
  parseTermSuggestions,
} from "../glossary/suggestions";
import { loadTermSourcesForExclusion } from "./job-store";
import type { AIProviderClient } from "../types/provider";
import type { ChunkProgress, LogEntry } from "../types/workflow";
import type { GlossaryReviewResult } from "../types/glossary";

export interface FinalizeGlossaryParams {
  providerConfig: AIProviderClient;
  novel: typeof novels.$inferSelect;
  chunkList: ChunkProgress[];
  fullTranslation: string;
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

export async function suggestAndReviewTerms({
  providerConfig,
  novel,
  chunkList,
  fullTranslation,
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
    const { approvedTerms, existingSources } = await loadTermSourcesForExclusion(novel.id);
    const fullRawSource = chunkList.map((c) => c.text || "").join("\n\n");
    const rawSourceExcerpt = fullRawSource.slice(0, 4000);
    const existingSourcesInChapter = existingSources.filter((source) =>
      fullRawSource.includes(source),
    );
    const approvedMappingsInChapter = approvedTerms.filter(({ source }) =>
      fullRawSource.includes(source),
    );

    const suggestPrompt = buildTermSuggestionPrompt(
      `${novel.sourceLang}->${novel.targetLang}`,
      existingSourcesInChapter,
      {
        rawSourceExcerpt,
        approvedMappings: approvedMappingsInChapter,
      },
    );

    const userMessage = buildTermSuggestionUserMessage(fullTranslation, {
      rawSourceExcerpt,
    });

    const suggestedTerms = await retryTranslationOperation(async () => {
      const suggestResult = await generateJsonCompletion(providerConfig, 0.3, [
        { role: "system", content: suggestPrompt },
        { role: "user", content: userMessage },
      ]);
      promptTokens += suggestResult.promptTokens;
      completionTokens += suggestResult.completionTokens;

      const parsed = parseTermSuggestions(suggestResult.content);
      if (parsed === null) throw new Error("Term suggestion returned invalid JSON");
      return parsed;
    });
    const reviewCandidates = prepareGlossarySuggestionCandidates(
      suggestedTerms,
      existingSources,
    ).candidates;
    let reviewResults: GlossaryReviewResult[] = [];

    if (reviewCandidates.length > 0) {
      logs.push(
        createLog("info", `Reviewing ${reviewCandidates.length} suggested term(s) with AI...`),
      );

      try {
        const reviewPrompt = buildGlossaryReviewPrompt(
          `${novel.sourceLang}->${novel.targetLang}`,
          selectRelevantApprovedMappings(reviewCandidates, approvedTerms),
        );
        const reviewUserMessage = buildGlossaryReviewUserMessage(
          reviewCandidates,
          fullRawSource,
          fullTranslation,
        );

        reviewResults = await retryTranslationOperation(async () => {
          const reviewResult = await generateJsonCompletion(providerConfig, 0.1, [
            { role: "system", content: reviewPrompt },
            { role: "user", content: reviewUserMessage },
          ]);
          promptTokens += reviewResult.promptTokens;
          completionTokens += reviewResult.completionTokens;

          const parsed = parseGlossaryReviewResponse(reviewResult.content);
          if (!parsed || parsed.length === 0) {
            throw new Error("Glossary review returned no valid reviews");
          }
          return parsed;
        });
      } catch (reviewErr) {
        logs.push(
          createLog(
            "warn",
            `AI review failed (${reviewErr instanceof Error ? reviewErr.message : "error"}) — no suggestions saved.`,
          ),
        );
      }
    }

    const policyResult = applyGlossarySuggestionPolicy({
      suggestions: suggestedTerms,
      reviews: reviewResults,
      fullRawSource,
      fullTranslation,
      existingSources,
    });

    rowsToInsert = policyResult.accepted.map((term) => ({
      id: nanoid(),
      novelId: novel.id,
      source: term.source,
      target: term.target,
      category: term.category,
      note: term.note || null,
      status: term.status,
    }));
    approvedCount = policyResult.accepted.filter((term) => term.status === "approved").length;
    pendingCount = policyResult.accepted.filter((term) => term.status === "pending").length;
    rejectedCount = policyResult.discardedCount;
    conflictCount = policyResult.conflictCount;

    const summary: string[] = [];
    if (approvedCount > 0) summary.push(`${approvedCount} approved`);
    if (pendingCount > 0) summary.push(`${pendingCount} pending`);
    if (rejectedCount > 0) summary.push(`${rejectedCount} discarded`);
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
