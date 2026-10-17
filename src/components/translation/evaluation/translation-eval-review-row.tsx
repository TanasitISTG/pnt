import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { ReviewRowDetails } from "@/components/translation/evaluation/translation-eval-review-row-details";
import { Badge } from "@/components/ui/badge";
import type { EvalReviewRow } from "@/lib/translation/evaluation/eval.schemas";

/** The key a chapter's freshness is named by, so the badge holds no word of its own. */
function snapshotKey(state: EvalReviewRow["snapshotState"]) {
  if (state === "current") return "snapshotCurrent" as const;
  if (state === "changed") return "snapshotChanged" as const;
  if (state === "deleted") return "snapshotDeleted" as const;
  return "snapshotUnknown" as const;
}

function snapshotVariant(
  state: EvalReviewRow["snapshotState"],
): "default" | "secondary" | "destructive" | "outline" {
  return state === "changed" || state === "deleted" ? "secondary" : "outline";
}

export function TranslationEvalReviewRow({
  novelId,
  row,
}: {
  novelId: string;
  row: EvalReviewRow;
}) {
  const t = useTranslations("evaluation");
  const canOpenChapter = row.snapshotState !== "deleted";

  return (
    <li className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="min-w-0 break-words text-body-lg font-semibold text-foreground">
              {t("chapterTitle", {
                number: Number(row.chapterNumber),
                title: row.chapterTitle,
              })}
            </h3>
            <Badge variant={snapshotVariant(row.snapshotState)}>
              {t(snapshotKey(row.snapshotState))}
            </Badge>
          </div>
          <ReviewRowDetails novelId={novelId} row={row} />
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          {canOpenChapter ? (
            <Link
              to="/{-$locale}/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: row.chapterId }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("openChapter")}
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
              {t("snapshotDeleted")}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
