import { Loader2, RefreshCw } from "lucide-react";

import { QueryErrorState } from "@/components/query-error-state";
import { TranslationEvalReviewRow } from "@/components/translation/translation-eval-review-row";
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
  if (report.chapterCount === 0) {
    return (
      <p className="py-5 text-sm text-muted-foreground">No chapters matched this selection.</p>
    );
  }
  if (filter === "attention") {
    if (!legacy && report.meta?.evaluatedChapterCount === 0) {
      return (
        <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
          Nothing was evaluated in this check. Translate the selected chapters, then run the check
          again.
        </p>
      );
    }
    return (
      <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
        No heuristic issues found in this check. Change the filter to inspect all selected chapters.
      </p>
    );
  }
  return (
    <p className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
      {legacy
        ? "This older report cannot classify untranslated chapters. Run it again for that filter."
        : "No untranslated chapters in this selection. Change the filter to inspect all findings."}
    </p>
  );
}

function ReportSummary({ report }: { report: EvalReportSummary }) {
  if (report.status !== "done") return null;
  const metrics = report.meta
    ? [
        ["Selected", report.chapterCount],
        ["Evaluated", report.meta.evaluatedChapterCount],
        ["Not translated", report.meta.skippedChapterCount],
        ["Needs attention", report.meta.attentionChapterCount],
      ]
    : [
        ["Selected", report.chapterCount],
        ["Residual script letters", report.residualScriptLetters],
        ["Paragraph differences", report.markerMismatches],
        [
          "Glossary adhered / matched",
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
  if (detail.detailsState === "unavailable") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground"
      >
        This saved quality report is unavailable because its stored details are malformed or from an
        unknown version. Run it again.
      </div>
    );
  }
  if (detail.detailsState === "pending") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
        {detail.report.status === "error"
          ? detail.report.error
          : detail.report.status === "running"
            ? "The quality check is still running."
            : "The quality check is queued and will appear here when complete."}
      </div>
    );
  }
  if (detail.rows.length === 0) {
    return <EmptyReviewState filter={reviewFilter} report={detail.report} legacy={legacy} />;
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="Quality check chapters" aria-busy={fetching}>
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
  const report = detail.report;
  const detailsReady = detail.detailsState === "ready";
  const legacy = detailsReady && report.meta === null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DialogDescription>Findings are a snapshot from this check.</DialogDescription>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => onRunAgain(report.chapterSelector)}
          disabled={queueing}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {queueing ? "Queueing…" : "Run again"}
        </Button>
      </div>

      {detail.contextChanged === true ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
          The language pair or approved glossary changed. Run this check again.
        </div>
      ) : null}

      <ReportSummary report={report} />
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="translationEvalFilter">Show</Label>
        <Select
          value={reviewSearch.reviewFilter}
          items={{
            attention: "Needs attention",
            all: "All selected chapters",
            untranslated: "Not translated",
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
            <SelectItem value="attention">Needs attention</SelectItem>
            <SelectItem value="all">All selected chapters</SelectItem>
            <SelectItem value="untranslated">Not translated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {detailsReady && legacy ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
          This older report cannot show freshness or all details. Run it again.
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
            formatRange={(first, last, total) => `${first}–${last} of ${total}`}
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
  if (props.isError) {
    return (
      <QueryErrorState
        title="Failed to load quality check"
        error={props.error}
        onRetry={props.onRetry}
        className="my-0 min-h-0"
      />
    );
  }
  if (props.isPending && !props.detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2
          className="mb-3 size-8 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="text-body">Loading quality check…</p>
      </div>
    );
  }
  if (!props.detail) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-body">Quality report not found.</p>
      </div>
    );
  }
  return <ReadyReportContent {...props} detail={props.detail} />;
}
