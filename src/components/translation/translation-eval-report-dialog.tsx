import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { QueryErrorState } from "@/components/query-error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DataTablePagination,
  type DataTablePaginationTable,
} from "@/components/ui/data-table-parts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "@tanstack/react-router";
import { formatLocalDateTime } from "@/lib/date-time";
import { translationEvalReportQueryOptions } from "@/lib/translation/evaluation/eval.query";
import type {
  EvalReportSummary,
  EvalReviewRow,
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

function statusLabel(status: EvalReportSummary["status"]): string {
  if (status === "pending") return "Queued";
  if (status === "running") return "Checking…";
  if (status === "error") return "Failed";
  return "Complete";
}

function statusVariant(
  status: EvalReportSummary["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "done") return "outline";
  return "secondary";
}

function snapshotLabel(state: EvalReviewRow["snapshotState"]): string {
  if (state === "current") return "Current snapshot";
  if (state === "changed") return "Changed since check";
  if (state === "deleted") return "Chapter deleted";
  return "Freshness unknown";
}

function snapshotVariant(
  state: EvalReviewRow["snapshotState"],
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "changed") return "secondary";
  if (state === "deleted") return "secondary";
  return "outline";
}

function warningLabels(row: EvalReviewRow): string[] {
  const warnings: string[] = [];
  if (row.residualScriptLetters > 0) {
    warnings.push(`Residual script: ${row.residualScriptLetters.toLocaleString()} letters`);
  }
  if (row.markerMismatches > 0) {
    if (row.rawParagraphCount !== null && row.translatedParagraphCount !== null) {
      warnings.push(
        `Paragraph counts differ: ${row.rawParagraphCount} source, ${row.translatedParagraphCount} translated`,
      );
    } else {
      warnings.push(`Paragraph count difference: ${row.markerMismatches}`);
    }
  }
  if (row.matchedGlossaryTerms > row.adheredGlossaryTerms) {
    warnings.push(
      `Approved glossary adherence: ${row.adheredGlossaryTerms}/${row.matchedGlossaryTerms}`,
    );
  }
  return warnings;
}

function formatMissingTerms(row: EvalReviewRow): string[] {
  if (!row.missingGlossaryTerms) return [];
  return row.missingGlossaryTerms.map((term) => `${term.source} → ${term.target}`);
}

function ReviewRow({ novelId, row }: { novelId: string; row: EvalReviewRow }) {
  const warnings = warningLabels(row);
  const missingTerms = formatMissingTerms(row);
  const missingCount = Math.max(0, row.matchedGlossaryTerms - row.adheredGlossaryTerms);
  const omittedMissingCount = row.missingGlossaryTerms
    ? Math.max(0, missingCount - row.missingGlossaryTerms.length)
    : 0;
  const omittedResidualCount = row.residualExamples
    ? Math.max(0, (row.residualSpanCount ?? 0) - row.residualExamples.length)
    : 0;
  const untranslated = row.evaluated === false;
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

          {untranslated ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Not translated — no quality checks performed</span>
            </p>
          ) : warnings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 text-sm text-foreground" aria-label="Findings">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="break-words">{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>No heuristic issues found in this check</span>
            </p>
          )}

          {!untranslated && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-caption text-muted-foreground">
              {row.rawParagraphCount !== null && row.translatedParagraphCount !== null ? (
                <span>
                  Paragraphs {row.rawParagraphCount} source / {row.translatedParagraphCount}{" "}
                  translated
                </span>
              ) : null}
              <span>
                Glossary {row.adheredGlossaryTerms}/{row.matchedGlossaryTerms} adhered
              </span>
              {row.evaluated !== null ? (
                <span>{row.evaluated ? "Evaluated" : "Skipped"}</span>
              ) : null}
            </div>
          )}

          {missingTerms.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <p className="font-medium text-foreground">Missing approved terms</p>
              <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                {missingTerms.map((term) => (
                  <li key={term} className="break-words">
                    {term}
                  </li>
                ))}
              </ul>
              {omittedMissingCount > 0 ? (
                <p className="mt-1 text-muted-foreground">and {omittedMissingCount} more</p>
              ) : null}
            </div>
          ) : null}

          {row.residualExamples && row.residualExamples.length > 0 ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <p className="font-medium text-foreground">Residual examples</p>
              <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                {row.residualExamples.map((example, index) => (
                  <li key={`${example}-${index}`} className="break-words">
                    {example}
                  </li>
                ))}
              </ul>
              {omittedResidualCount > 0 ? (
                <p className="mt-1 text-muted-foreground">and {omittedResidualCount} more</p>
              ) : null}
            </div>
          ) : null}
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

export function TranslationEvalReportDialog({
  novelId,
  reviewSearch,
  onReviewSearchChange,
  onRunAgain,
  queueing,
}: TranslationEvalReportDialogProps) {
  const open = Boolean(reviewSearch.reviewReport);
  const mounted = useHydrated();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailQuery = useQuery(translationEvalReportQueryOptions(novelId, reviewSearch, open));
  const detail = detailQuery.data;
  const legacy = detail?.detailsState === "ready" && detail.report.meta === null;

  useEffect(() => {
    if (
      !open ||
      !detail ||
      detail.detailsState !== "ready" ||
      detailQuery.isPlaceholderData ||
      detailQuery.isFetching
    )
      return;
    if (detail.page !== reviewSearch.reviewPage) {
      onReviewSearchChange({ reviewPage: detail.page });
    }
  }, [
    detail,
    detailQuery.isPlaceholderData,
    detailQuery.isFetching,
    onReviewSearchChange,
    open,
    reviewSearch.reviewPage,
  ]);

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
  const detailsReady = detail?.detailsState === "ready";

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
        <DialogHeader className="shrink-0 border-b border-border pb-4 pr-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle
                ref={headingRef}
                tabIndex={-1}
                className="break-words text-card-title font-semibold tracking-tight outline-none"
              >
                Quality check
              </DialogTitle>
              {report ? (
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {report.chapterSelector} · {report.completedAt ? "Checked" : "Created"}{" "}
                  {mounted ? formatLocalDateTime(report.completedAt ?? report.createdAt) : "—"}
                </p>
              ) : null}
            </div>
            <span role="status" aria-live="polite">
              {status ? (
                <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
              ) : detailQuery.isError ? (
                "Unavailable"
              ) : (
                "Loading quality check…"
              )}
            </span>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain sm:gap-5 sm:pr-2 [&_button]:min-h-11">
          {detailQuery.isError ? (
            <QueryErrorState
              title="Failed to load quality check"
              error={detailQuery.error}
              onRetry={() => void detailQuery.refetch()}
              className="my-0 min-h-0"
            />
          ) : detailQuery.isPending && !detail ? (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2
                className="mb-3 size-8 animate-spin motion-reduce:animate-none text-primary"
                aria-hidden="true"
              />
              <p className="text-body">Loading quality check…</p>
            </div>
          ) : report && detail ? (
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

              {detail.detailsState === "unavailable" ? (
                <div
                  role="alert"
                  className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground"
                >
                  This saved quality report is unavailable because its stored details are malformed
                  or from an unknown version. Run it again.
                </div>
              ) : detail.detailsState === "pending" ? (
                <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground">
                  {report.status === "error"
                    ? report.error
                    : report.status === "running"
                      ? "The quality check is still running."
                      : "The quality check is queued and will appear here when complete."}
                </div>
              ) : detail.rows.length > 0 ? (
                <ol
                  className="flex flex-col gap-3"
                  aria-label="Quality check chapters"
                  aria-busy={detailQuery.isFetching}
                >
                  {detail.rows.map((row) => (
                    <ReviewRow key={row.chapterId} novelId={novelId} row={row} />
                  ))}
                </ol>
              ) : (
                <EmptyReviewState
                  filter={reviewSearch.reviewFilter}
                  report={report}
                  legacy={legacy}
                />
              )}

              {detailsReady && detail.rowCount > 0 ? (
                <div className="[&_button[aria-label]]:min-w-11">
                  <DataTablePagination
                    table={paginationTable}
                    firstRow={(currentPage - 1) * detail.pageSize + 1}
                    lastRow={Math.min(currentPage * detail.pageSize, detail.rowCount)}
                    rowCount={detail.rowCount}
                    currentPage={currentPage}
                    busy={detailQuery.isFetching}
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
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground">
              <p className="text-body">Quality report not found.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
