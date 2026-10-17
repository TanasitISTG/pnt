import { RefreshCw } from "lucide-react";
import { useTranslations } from "use-intl";

import { QueryErrorState } from "@/components/query-error-state";
import { TranslationEvalReviewRow } from "@/components/translation/evaluation/translation-eval-review-row";
import { Button } from "@/components/ui/button";
import {
  DataTablePagination,
  type DataTablePaginationTable,
} from "@/components/ui/data-table-parts";
import { DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { translateMessage } from "@/lib/i18n/server-error";
import type {
  EvalReportDetail,
  EvalReportSummary,
  EvalReviewSearch,
} from "@/lib/translation/evaluation/eval.schemas";

interface TranslationEvalReportContentProps {
  novelId: string;
  reviewSearch: EvalReviewSearch;
  detail: EvalReportDetail | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  queueing: boolean;
  paginationTable: DataTablePaginationTable;
  currentPage: number;
  onRetry: () => void;
  onRunAgain: (selector: string) => void;
  onReviewSearchChange: (patch: Partial<EvalReviewSearch>) => void;
}

function EmptyReviewState({
  filter,
  report,
  legacy,
}: {
  filter: EvalReviewSearch["reviewFilter"];
  report: EvalReportSummary;
  legacy: boolean;
}) {
  const t = useTranslations("evaluation");
  if (report.chapterCount === 0) {
    return <p className="py-5 text-sm text-muted-foreground">{t("emptyNoChapters")}</p>;
  }
  if (filter === "attention") {
    if (!legacy && report.meta?.evaluatedChapterCount === 0) {
      return (
        <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
          {t("emptyNothingEvaluated")}
        </p>
      );
    }
    return (
      <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
        {t("emptyNoIssues")}
      </p>
    );
  }
  return (
    <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
      {legacy ? t("emptyLegacyUntranslated") : t("emptyNoUntranslated")}
    </p>
  );
}

function ReportSummary({ report }: { report: EvalReportSummary }) {
  const t = useTranslations("evaluation");
  if (report.status !== "done") return null;
  const metrics = report.meta
    ? [
        [t("metricSelected"), report.chapterCount],
        [t("metricEvaluated"), report.meta.evaluatedChapterCount],
        [t("metricNotTranslated"), report.meta.skippedChapterCount],
        [t("metricNeedsAttention"), report.meta.attentionChapterCount],
      ]
    : [
        [t("metricSelected"), report.chapterCount],
        [t("metricResidualScript"), report.residualScriptLetters],
        [t("metricParagraphDifferences"), report.markerMismatches],
        [
          t("metricGlossaryAdhered"),
          `${report.adheredGlossaryTerms} / ${report.matchedGlossaryTerms}`,
        ],
      ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 sm:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-caption text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-body-lg font-semibold tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportFindings({
  novelId,
  detail,
  reviewFilter,
  legacy,
  fetching,
}: {
  novelId: string;
  detail: EvalReportDetail;
  reviewFilter: EvalReviewSearch["reviewFilter"];
  legacy: boolean;
  fetching: boolean;
}) {
  const t = useTranslations("evaluation");
  // The report's failure is stored as a code (`errors.qualityCheckFailed`) by the worker that
  // stopped, long before this panel existed, so it is resolved the way a job's log row is.
  const tRoot = useTranslations();
  if (detail.detailsState === "unavailable") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground"
      >
        {t("detailsUnavailable")}
      </div>
    );
  }
  if (detail.detailsState === "pending") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
        {detail.report.status === "error"
          ? (translateMessage(detail.report.error ?? "", tRoot) ?? detail.report.error)
          : detail.report.status === "running"
            ? t("noticeRunning")
            : t("noticeQueued")}
      </div>
    );
  }
  if (detail.rows.length === 0) {
    return <EmptyReviewState filter={reviewFilter} report={detail.report} legacy={legacy} />;
  }
  return (
    <ol className="flex flex-col gap-3" aria-label={t("listLabel")} aria-busy={fetching}>
      {detail.rows.map((row) => (
        <TranslationEvalReviewRow key={row.chapterId} novelId={novelId} row={row} />
      ))}
    </ol>
  );
}

function ReadyReportContent({
  novelId,
  reviewSearch,
  detail,
  isFetching,
  queueing,
  paginationTable,
  currentPage,
  onRunAgain,
  onReviewSearchChange,
}: Omit<
  TranslationEvalReportContentProps,
  "detail" | "error" | "isError" | "isPending" | "onRetry"
> & { detail: EvalReportDetail }) {
  const t = useTranslations("evaluation");
  const report = detail.report;
  const detailsReady = detail.detailsState === "ready";
  const legacy = detailsReady && report.meta === null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DialogDescription>{t("snapshotNotice")}</DialogDescription>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => onRunAgain(report.chapterSelector)}
          disabled={queueing}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {queueing ? t("queueing") : t("runAgain")}
        </Button>
      </div>

      {detail.contextChanged === true ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
          {t("contextChanged")}
        </div>
      ) : null}

      <ReportSummary report={report} />
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="translationEvalFilter">{t("showLabel")}</Label>
        <Select
          value={reviewSearch.reviewFilter}
          items={{
            attention: t("filterAttention"),
            all: t("filterAll"),
            untranslated: t("filterUntranslated"),
          }}
          onValueChange={(value) => {
            if (value === "attention" || value === "all" || value === "untranslated") {
              onReviewSearchChange({ reviewFilter: value, reviewPage: 1 });
            }
          }}
        >
          <SelectTrigger id="translationEvalFilter" className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="attention">{t("filterAttention")}</SelectItem>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="untranslated">{t("filterUntranslated")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {detailsReady && legacy ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
          {t("legacyNotice")}
        </div>
      ) : null}

      <ReportFindings
        novelId={novelId}
        detail={detail}
        reviewFilter={reviewSearch.reviewFilter}
        legacy={legacy}
        fetching={isFetching}
      />

      {detailsReady && detail.rowCount > 0 ? (
        <div className="[&_button[aria-label]]:min-w-11">
          <DataTablePagination
            table={paginationTable}
            firstRow={(currentPage - 1) * detail.pageSize + 1}
            lastRow={Math.min(currentPage * detail.pageSize, detail.rowCount)}
            rowCount={detail.rowCount}
            currentPage={currentPage}
            busy={isFetching}
            pageSize={detail.pageSize}
            pageSizeOptions={[10, 25, 50]}
            noun={t("nounChapters")}
            onPageSizeChange={(pageSize) => {
              if (pageSize === 10 || pageSize === 25 || pageSize === 50) {
                onReviewSearchChange({ reviewPageSize: pageSize, reviewPage: 1 });
              }
            }}
          />
        </div>
      ) : null}
    </>
  );
}

export function TranslationEvalReportContent(props: TranslationEvalReportContentProps) {
  const t = useTranslations("evaluation");
  if (props.isError) {
    return (
      <QueryErrorState
        title={t("contentFailed")}
        error={props.error}
        onRetry={props.onRetry}
        className="my-0 min-h-0"
      />
    );
  }
  if (props.isPending && !props.detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
        <Spinner variant="primary" className="mb-3 size-8" aria-hidden="true" />
        <p className="text-body">{t("loading")}</p>
      </div>
    );
  }
  if (!props.detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-body">{t("notFound")}</p>
      </div>
    );
  }
  return <ReadyReportContent {...props} detail={props.detail} />;
}
