import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useTranslations } from "use-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ChapterRow } from "@/components/chapters/types";
import { formatCost, formatTokens } from "@/lib/utils";

export interface StudioProgressCosts {
  totals: {
    promptTokens: number;
    completionTokens: number;
    cost: number | null;
    estimatedChapterCount: number;
    unpricedChapterCount: number;
  };
}

export interface StudioProgressGlossary {
  total: number;
  approved: number;
  pending: number;
}

export interface StudioProgressCardProps {
  novelId: string;
  chapters: ChapterRow[];
  chaptersPending: boolean;
  costData: StudioProgressCosts | undefined;
  glossaryStats: StudioProgressGlossary | undefined;
}

/**
 * The novel-level summary the owner used to read on the public page. It lives in the studio
 * now because it is management information: how much of the novel is translated, what that
 * cost, and how the glossary stands. The reading page shows a reader's progress instead.
 */
export function StudioProgressCard({
  novelId,
  chapters,
  chaptersPending,
  costData,
  glossaryStats,
}: StudioProgressCardProps) {
  const t = useTranslations("studio");
  const translatedChapterCount = chaptersPending
    ? 0
    : chapters.filter((chapter) => chapter.status === "translated").length;
  const progressPercent =
    chaptersPending || chapters.length === 0
      ? 0
      : Math.round((translatedChapterCount / chapters.length) * 100);
  const hasUsage =
    costData &&
    (costData.totals.promptTokens > 0 ||
      costData.totals.completionTokens > 0 ||
      costData.totals.unpricedChapterCount > 0);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span>{t("statusTranslated")}</span>
            <span className="tabular-nums">
              {chaptersPending
                ? t("loadingChapterProgress")
                : t("progressSummary", {
                    percent: progressPercent,
                    translated: translatedChapterCount,
                    total: chapters.length,
                  })}
            </span>
          </div>
          <Progress value={chaptersPending ? null : progressPercent} className="h-2 max-w-md" />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
          {hasUsage && costData ? (
            <span className="font-mono">
              {t("tokensInOut", {
                input: formatTokens(costData.totals.promptTokens),
                output: formatTokens(costData.totals.completionTokens),
              })}
              {costData.totals.cost != null ? ` · ${formatCost(costData.totals.cost)}` : null}
              {costData.totals.unpricedChapterCount > 0
                ? ` · ${t("unpricedChapters", { count: costData.totals.unpricedChapterCount })}`
                : costData.totals.estimatedChapterCount > 0
                  ? ` · ${t("estimatedChapters", {
                      count: costData.totals.estimatedChapterCount,
                    })}`
                  : null}
            </span>
          ) : null}
          <Link
            to="/novels/$novelId/manage/glossary"
            params={{ novelId }}
            className="inline-flex items-center gap-1.5 text-muted-foreground no-underline transition-colors duration-micro hover:text-foreground"
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            {glossaryStats
              ? t("glossaryApproved", {
                  approved: glossaryStats.approved,
                  total: glossaryStats.total,
                })
              : t("sectionGlossary")}
            {glossaryStats && glossaryStats.pending > 0 ? (
              <span className="text-warning">
                {t("glossaryPending", { count: glossaryStats.pending })}
              </span>
            ) : null}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
