import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { QueryErrorState } from "@/components/query-error-state";
import { TranslationEvalReportDialog } from "@/components/translation/translation-eval-report-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatLocalDateTime } from "@/lib/date-time";
import { translationEvalReportsQueryOptions } from "@/lib/translation/evaluation/eval.query";
import { startTranslationEval } from "@/lib/translation/evaluation/eval.functions";
import {
  startTranslationEvalSchema,
  type EvalReportSummary,
  type EvalReviewSearch,
} from "@/lib/translation/evaluation/eval.schemas";
import { useHydrated } from "@/lib/use-hydrated";

interface TranslationQualityPanelProps {
  novelId: string;
  reviewSearch: EvalReviewSearch;
  onReviewSearchChange: (patch: Partial<EvalReviewSearch>) => void;
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

function LatestSummary({
  report,
  mounted,
  onView,
}: {
  report: EvalReportSummary;
  mounted: boolean;
  onView: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">Latest check</p>
            <Badge variant={statusVariant(report.status)}>{statusLabel(report.status)}</Badge>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {report.chapterSelector} · {mounted ? formatLocalDateTime(report.createdAt) : "—"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-11" onClick={onView}>
          {report.status === "done" ? "View findings" : "View check"}
        </Button>
      </div>

      {report.status === "error" ? (
        <p className="mt-3 text-sm text-destructive">{report.error}</p>
      ) : report.status !== "done" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This check updates automatically. You can leave and return while it runs.
        </p>
      ) : report.meta ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <SummaryMetric label="Selected" value={report.chapterCount} />
          <SummaryMetric label="Evaluated" value={report.meta.evaluatedChapterCount} />
          <SummaryMetric label="Not translated" value={report.meta.skippedChapterCount} />
          <SummaryMetric label="Needs attention" value={report.meta.attentionChapterCount} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {report.chapterCount} selected chapters · {report.residualScriptLetters} residual-script
          letters · {report.markerMismatches} paragraph differences · Glossary{" "}
          {report.adheredGlossaryTerms}/{report.matchedGlossaryTerms} adhered
        </p>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="mt-1 text-body-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function CheckHistory({
  reports,
  mounted,
  onView,
}: {
  reports: EvalReportSummary[];
  mounted: boolean;
  onView: (report: EvalReportSummary) => void;
}) {
  return (
    <details className="rounded-xl border border-border">
      <summary className="cursor-pointer list-inside px-4 py-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Check history ({reports.length})
      </summary>
      <div className="border-t border-border">
        <ul className="divide-y divide-border">
          {reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">
                  {report.chapterSelector}
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {mounted ? formatLocalDateTime(report.createdAt) : "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(report.status)}>{statusLabel(report.status)}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onView(report)}
                >
                  {report.status === "done" ? "View findings" : "View check"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function TranslationQualityPanel({
  novelId,
  reviewSearch,
  onReviewSearchChange,
}: TranslationQualityPanelProps) {
  const queryClient = useQueryClient();
  const selectorInputRef = useRef<HTMLInputElement>(null);
  const [selector, setSelector] = useState("first3");
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const mounted = useHydrated();
  const reportsQuery = useQuery(translationEvalReportsQueryOptions(novelId));
  const reports = reportsQuery.data ?? [];
  const latest = reports[0];

  const { mutate: runEval, isPending: queueing } = useMutation({
    mutationFn: (nextSelector: string) =>
      startTranslationEval({ data: { novelId, chapterSelector: nextSelector } }),
    onSuccess: ({ reportId }) => {
      void queryClient.invalidateQueries({ queryKey: ["translation-eval-reports", novelId] });
      onReviewSearchChange({
        reviewReport: reportId,
        reviewFilter: "attention",
        reviewPage: 1,
        reviewPageSize: 25,
      });
      toast.success("Quality check queued");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to queue quality check");
    },
  });

  const queueSelector = (nextSelector: string, closeReview = false) => {
    setSelector(nextSelector);
    const result = startTranslationEvalSchema.safeParse({
      novelId,
      chapterSelector: nextSelector,
    });
    if (!result.success) {
      setSelectorError(result.error.issues[0]?.message ?? "Enter a valid chapter selection.");
      if (closeReview) {
        onReviewSearchChange({
          reviewReport: undefined,
          reviewFilter: "attention",
          reviewPage: 1,
          reviewPageSize: 25,
        });
      }
      if (!closeReview) selectorInputRef.current?.focus();
      return;
    }
    setSelectorError(null);
    runEval(result.data.chapterSelector);
  };

  const viewReport = (report: EvalReportSummary) => {
    onReviewSearchChange({
      reviewReport: report.id,
      reviewFilter: "attention",
      reviewPage: 1,
      reviewPageSize: 25,
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Translation quality</CardTitle>
          <CardDescription>
            Checks script, paragraph counts, and approved glossary terms. These warnings do not
            verify translation accuracy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              queueSelector(selector);
            }}
          >
            <Label htmlFor="translationEvalSelector">Chapters to check</Label>
            <p id="translationEvalSelectorHelp" className="text-caption text-muted-foreground">
              Use <code>first3</code>, <code>all</code>, or chapter numbers and ranges such as{" "}
              <code>1,1.5,5-8</code>.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                ref={selectorInputRef}
                id="translationEvalSelector"
                name="chapterSelector"
                autoComplete="off"
                spellCheck={false}
                value={selector}
                onChange={(event) => {
                  setSelector(event.target.value);
                  if (selectorError) setSelectorError(null);
                }}
                aria-describedby={
                  selectorError
                    ? "translationEvalSelectorHelp translationEvalSelectorError"
                    : "translationEvalSelectorHelp"
                }
                aria-invalid={selectorError ? true : undefined}
                className="min-h-11"
              />
              <Button type="submit" className="min-h-11" disabled={queueing}>
                {queueing ? "Queueing…" : "Run check"}
              </Button>
            </div>
            {selectorError ? (
              <p
                id="translationEvalSelectorError"
                className="text-sm font-medium text-destructive"
                role="alert"
              >
                {selectorError}
              </p>
            ) : null}
          </form>

          {latest ? (
            <LatestSummary report={latest} mounted={mounted} onView={() => viewReport(latest)} />
          ) : reportsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading check history…</p>
          ) : null}

          {reportsQuery.isError ? (
            <QueryErrorState
              title="Failed to load quality history"
              error={reportsQuery.error}
              onRetry={() => void reportsQuery.refetch()}
              className="my-0 min-h-0"
            />
          ) : reports.length > 0 ? (
            <CheckHistory reports={reports} mounted={mounted} onView={viewReport} />
          ) : !reportsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">
              No checks yet. Choose chapters to run your first check.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <TranslationEvalReportDialog
        novelId={novelId}
        reviewSearch={reviewSearch}
        onReviewSearchChange={onReviewSearchChange}
        onRunAgain={(nextSelector) => queueSelector(nextSelector, true)}
        queueing={queueing}
      />
    </>
  );
}
