import { Link } from "@tanstack/react-router";

import { ReviewRowDetails } from "@/components/translation/translation-eval-review-row-details";
import { Badge } from "@/components/ui/badge";
import type { EvalReviewRow } from "@/lib/translation/evaluation/eval.schemas";

function snapshotLabel(state: EvalReviewRow["snapshotState"]): string {
  if (state === "current") return "Current snapshot";
  if (state === "changed") return "Changed since check";
  if (state === "deleted") return "Chapter deleted";
  return "Freshness unknown";
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
  const canOpenChapter = row.snapshotState !== "deleted";

  return (
    <li className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="min-w-0 break-words text-body-lg font-semibold text-foreground">
              Ch. {Number(row.chapterNumber)} — {row.chapterTitle}
            </h3>
            <Badge variant={snapshotVariant(row.snapshotState)}>
              {snapshotLabel(row.snapshotState)}
            </Badge>
          </div>
          <ReviewRowDetails row={row} />
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          {canOpenChapter ? (
            <Link
              to="/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: row.chapterId }}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open chapter
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
              Chapter deleted
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
