import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { useLocale, useTranslations } from "use-intl";

import { TranslationEvalReportContent } from "@/components/translation/evaluation/translation-eval-report-content";
import { Badge } from "@/components/ui/badge";
import { type DataTablePaginationTable } from "@/components/ui/data-table-parts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/i18n/format";
import { translationEvalReportQueryOptions } from "@/lib/translation/evaluation/eval.query";
import type {
  EvalReportSummary,
  EvalReviewSearch,
} from "@/lib/translation/evaluation/eval.schemas";
import { useHydrated } from "@/lib/use-hydrated";

interface TranslationEvalReportDialogProps {
  novelId: string;
  reviewSearch: EvalReviewSearch;
  onReviewSearchChange: (patch: Partial<EvalReviewSearch>) => void;
  onRunAgain: (selector: string) => void;
  queueing: boolean;
}

/** The key a report's status is named by, so a badge never holds a word of its own. */
function statusKey(status: EvalReportSummary["status"]) {
  if (status === "pending") return "statusQueued" as const;
  if (status === "running") return "statusChecking" as const;
  if (status === "error") return "statusFailed" as const;
  return "statusComplete" as const;
}

function statusVariant(
  status: EvalReportSummary["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "done") return "outline";
  return "secondary";
}

export function TranslationEvalReportDialog({
  novelId,
  reviewSearch,
  onReviewSearchChange,
  onRunAgain,
  queueing,
}: TranslationEvalReportDialogProps) {
  const t = useTranslations("evaluation");
  const locale = useLocale();
  const open = Boolean(reviewSearch.reviewReport);
  const mounted = useHydrated();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailQuery = useQuery(translationEvalReportQueryOptions(novelId, reviewSearch, open));
  const detail = detailQuery.data;

  const pageCount = detail ? Math.max(1, Math.ceil(detail.rowCount / detail.pageSize)) : 1;
  const currentPage = detail?.page ?? reviewSearch.reviewPage;
  const paginationTable = useMemo<DataTablePaginationTable>(() => {
    const page = Math.min(currentPage, pageCount);
    return {
      firstPage: () => onReviewSearchChange({ reviewPage: 1 }),
      previousPage: () => onReviewSearchChange({ reviewPage: Math.max(1, page - 1) }),
      nextPage: () => onReviewSearchChange({ reviewPage: Math.min(pageCount, page + 1) }),
      lastPage: () => onReviewSearchChange({ reviewPage: pageCount }),
      getCanPreviousPage: () => page > 1,
      getCanNextPage: () => page < pageCount,
      getCanLastPage: () => page < pageCount,
      getPageCount: () => pageCount,
    };
  }, [currentPage, onReviewSearchChange, pageCount]);

  const report = detail?.report;
  const status = report?.status;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onReviewSearchChange({
            reviewReport: undefined,
            reviewFilter: "attention",
            reviewPage: 1,
            reviewPageSize: 25,
          });
        }
      }}
    >
      <DialogContent
        initialFocus={headingRef}
        finalFocus={() =>
          document.querySelector<HTMLElement>("#translationEvalSelector[aria-invalid=true]") ?? true
        }
        className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-4 overflow-hidden p-4 sm:max-w-5xl sm:gap-5 sm:p-6 [&_[data-slot=dialog-close]]:size-11"
      >
        <DialogHeader variant="divided" className="shrink-0 pb-4 pr-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle
                ref={headingRef}
                tabIndex={-1}
                initialFocus
                className="break-words text-card-title font-semibold tracking-tight"
              >
                {t("dialogTitle")}
              </DialogTitle>
              {report ? (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {report.chapterSelector} · {report.completedAt ? t("checked") : t("created")}{" "}
                  {mounted ? formatDateTime(report.completedAt ?? report.createdAt, locale) : "—"}
                </p>
              ) : null}
            </div>
            <span role="status" aria-live="polite">
              {status ? (
                <Badge variant={statusVariant(status)}>{t(statusKey(status))}</Badge>
              ) : detailQuery.isError ? (
                t("unavailable")
              ) : (
                t("loading")
              )}
            </span>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain sm:gap-5 sm:pr-2 [&_button]:min-h-11">
          <TranslationEvalReportContent
            novelId={novelId}
            reviewSearch={reviewSearch}
            detail={detail}
            error={detailQuery.error}
            isError={detailQuery.isError}
            isPending={detailQuery.isPending}
            isFetching={detailQuery.isFetching}
            queueing={queueing}
            paginationTable={paginationTable}
            currentPage={currentPage}
            onRetry={() => void detailQuery.refetch()}
            onRunAgain={onRunAgain}
            onReviewSearchChange={onReviewSearchChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
