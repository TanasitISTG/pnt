import "@tanstack/react-start/server-only";

import type { novels, chapters } from "@/lib/db/schema";
import { createLog } from "./log-entry";
import type { AIProviderClient, LogEntry } from "./translation.types";
import { translateChapterTitle } from "./title";
import { buildSummaryPrompt } from "./prompts";

export interface FinalizeSummaryParams {
  providerConfig: AIProviderClient;
  novel: typeof novels.$inferSelect;
  chapter: typeof chapters.$inferSelect;
  fullTranslation: string;
  logs: LogEntry[];
}

export interface FinalizeSummaryResult {
  translatedTitle?: string;
  freshSummary?: string;
  updatedStorySummary?: string;
  promptTokens: number;
  completionTokens: number;
}

export async function generateSummaryArtifacts({
  providerConfig,
  novel,
  chapter,
  fullTranslation,
  logs,
}: FinalizeSummaryParams): Promise<FinalizeSummaryResult> {
  let promptTokens = 0;
  let completionTokens = 0;
  let translatedTitle: string | undefined;

  // Translate chapter title (cheap, non-fatal)
  const titleRes = await translateChapterTitle(
    providerConfig,
    `${novel.sourceLang}->${novel.targetLang}`,
    chapter.title,
  );
  promptTokens += titleRes.promptTokens;
  completionTokens += titleRes.completionTokens;
  if (titleRes.translated) {
    translatedTitle = titleRes.translated;
    logs.push(createLog("success", `Title translated: "${titleRes.translated}"`));
  } else {
    logs.push(createLog("warn", "Title translation skipped — keeping raw title."));
  }

  // Generate chapter summary in English
  logs.push(createLog("info", "Generating English chapter summary..."));
  const summaryStartTime = Date.now();

  let freshSummary: string | undefined;
  let updatedStorySummary: string | undefined;
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
    promptTokens += summaryCompletion.usage?.promptTokens || 0;
    completionTokens += summaryCompletion.usage?.completionTokens || 0;
    const content = summaryCompletion.content || null;
    if (content) {
      freshSummary = content;
    }
    const summaryTime = ((Date.now() - summaryStartTime) / 1000).toFixed(1);
    logs.push(createLog("success", `Summary generated in ${summaryTime}s.`));

    if (freshSummary) {
      // Update rolling story summary on novel (non-fatal)
      try {
        const storySummaryCompletion = await providerConfig.generateChatCompletion({
          model: providerConfig.fastModel ?? undefined,
          messages: [
            {
              role: "system",
              content:
                "You are a novel continuity editor. Maintain a running story synopsis (≤400 words in English) of the novel so far. Combine the existing story synopsis with the new chapter summary to create an updated, coherent summary of key events, ongoing plot arcs, and main character states. DIALOGUE CONTINUITY: record only evidenced character gender/role, directed relationship changes, and recurring speech-register facts; this is supporting context and must not overwrite the structured relationship map. Output ONLY the updated synopsis.",
            },
            {
              role: "user",
              content: `Existing story synopsis:\n${
                novel.storySummary || "None (this is the beginning of the novel)."
              }\n\nDIALOGUE CONTINUITY comes only from the new chapter summary:\n${freshSummary}`,
            },
          ],
        });
        promptTokens += storySummaryCompletion.usage?.promptTokens || 0;
        completionTokens += storySummaryCompletion.usage?.completionTokens || 0;
        updatedStorySummary = storySummaryCompletion.content?.trim() || undefined;
        if (updatedStorySummary) {
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

  return {
    translatedTitle,
    freshSummary,
    updatedStorySummary,
    promptTokens,
    completionTokens,
  };
}
