import "@tanstack/react-start/server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novels, providerSettings, translationJobs } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import type { NovelCostData, NovelCostSource } from "@/lib/translation/types/api";
import { calculateTokenCost } from "@/lib/translation/cost";

function parseUsage(
  value: string | null,
): { promptTokens: number; completionTokens: number } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const promptTokens = record.totalPromptTokens;
    const completionTokens = record.totalCompletionTokens;
    if (
      typeof promptTokens !== "number" ||
      !Number.isFinite(promptTokens) ||
      promptTokens < 0 ||
      typeof completionTokens !== "number" ||
      !Number.isFinite(completionTokens) ||
      completionTokens < 0
    ) {
      return null;
    }
    return { promptTokens, completionTokens };
  } catch {
    return null;
  }
}

export async function getNovelCostsForOwnedNovel(
  userId: string,
  novelId: string,
): Promise<NovelCostData> {
  const [rows, settingsRows] = await Promise.all([
    db
      .selectDistinctOn([translationJobs.chapterId], {
        chapterId: translationJobs.chapterId,
        usageJson: translationJobs.usageJson,
        provider: translationJobs.provider,
        model: translationJobs.model,
        inputPricePer1M: translationJobs.inputPricePer1M,
        outputPricePer1M: translationJobs.outputPricePer1M,
      })
      .from(translationJobs)
      .innerJoin(chapters, eq(translationJobs.chapterId, chapters.id))
      .innerJoin(novels, eq(chapters.novelId, novels.id))
      .where(
        and(eq(novels.id, novelId), eq(novels.userId, userId), eq(translationJobs.status, "done")),
      )
      .orderBy(translationJobs.chapterId, desc(translationJobs.updatedAt)),
    db
      .select({
        inputPricePer1M: providerSettings.inputPricePer1M,
        outputPricePer1M: providerSettings.outputPricePer1M,
      })
      .from(providerSettings)
      .where(eq(providerSettings.userId, userId))
      .limit(1),
  ]);

  const settings = settingsRows[0];
  const perChapter: NovelCostData["costs"] = {};
  let totalPrompt = 0;
  let totalCompletion = 0;
  let pricedCost = 0;
  let estimatedCost = 0;
  let pricedChapterCount = 0;
  let estimatedChapterCount = 0;
  let unpricedChapterCount = 0;

  for (const row of rows) {
    const usage = parseUsage(row.usageJson);
    const promptTokens = usage?.promptTokens ?? 0;
    const completionTokens = usage?.completionTokens ?? 0;
    const isLegacy = row.provider === null || row.model === null;
    const source: NovelCostSource = isLegacy ? "current-settings-estimate" : "historical";
    const cost = usage
      ? calculateTokenCost(
          promptTokens,
          completionTokens,
          isLegacy ? settings?.inputPricePer1M : row.inputPricePer1M,
          isLegacy ? settings?.outputPricePer1M : row.outputPricePer1M,
        )
      : null;
    const resolvedSource: NovelCostSource = cost === null ? "unpriced" : source;

    perChapter[row.chapterId] = {
      promptTokens,
      completionTokens,
      cost,
      source: resolvedSource,
    };

    if (!usage) {
      unpricedChapterCount++;
      continue;
    }
    totalPrompt += promptTokens;
    totalCompletion += completionTokens;
    if (cost === null) {
      unpricedChapterCount++;
    } else if (source === "historical") {
      pricedChapterCount++;
      pricedCost += cost;
    } else {
      estimatedChapterCount++;
      estimatedCost += cost;
    }
  }

  return {
    costs: perChapter,
    totals: {
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      cost: rows.length > 0 && unpricedChapterCount === 0 ? pricedCost + estimatedCost : null,
      pricedCost,
      estimatedCost,
      pricedChapterCount,
      estimatedChapterCount,
      unpricedChapterCount,
    },
  };
}

export async function getNovelCostsForUser(
  userId: string,
  novelId: string,
): Promise<NovelCostData> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
  return getNovelCostsForOwnedNovel(userId, novelId);
}
