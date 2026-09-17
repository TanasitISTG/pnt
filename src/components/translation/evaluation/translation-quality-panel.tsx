import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { QueryErrorState } from "@/components/query-error-state";
import { TranslationEvalReportDialog } from "@/components/translation/evaluation/translation-eval-report-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatLocalDateTime } from "@/lib/date-time";
import { translationEvalReportsQueryOptions } from "@/lib/translation/evaluation/eval.query";
import { startTranslationEval } from "@/lib/translation/evaluation/eval.functions";
import {
  evalSelectorSchema,
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

const qualityCheckFormSchema = z.object({ chapterSelector: evalSelectorSchema });

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
  const mounted = useHydrated();
  const reportsQuery = useQuery(translationEvalReportsQueryOptions(novelId));
  const reports = reportsQuery.data ?? [];
  const latest = reports[0];

  const { mutateAsync: runEval, isPending: queueing } = useMutation({
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

  const closeReview = useCallback(() => {
    onReviewSearchChange({
      reviewReport: undefined,
      reviewFilter: "attention",
      reviewPage: 1,
      reviewPageSize: 25,
    });
  }, [onReviewSearchChange]);

  const form = useForm({
    defaultValues: {
      chapterSelector: "first3",
    },
    onSubmitMeta: { closeReview: false },
    validators: {
      onSubmit: qualityCheckFormSchema,
    },
    onSubmitInvalid: ({ meta }) => {
      if (meta.closeReview) {
        closeReview();
        return;
      }
      selectorInputRef.current?.focus();
    },
    onSubmit: async ({ value }) => {
      const parsed = startTranslationEvalSchema.parse({
        novelId,
        chapterSelector: value.chapterSelector,
      });
      try {
        await runEval(parsed.chapterSelector);
      } catch {
        // The mutation owns the error toast.
      }
    },
  });

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
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="chapterSelector">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="translationEvalSelector">Chapters to check</FieldLabel>
                    <FieldDescription id="translationEvalSelectorHelp">
                      Use <code>first3</code>, <code>all</code>, or chapter numbers and ranges such
                      as <code>1,1.5,5-8</code>.
                    </FieldDescription>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Input
                        ref={selectorInputRef}
                        id="translationEvalSelector"
                        name={field.name}
                        autoComplete="off"
                        spellCheck={false}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        aria-describedby={
                          invalid
                            ? "translationEvalSelectorHelp translationEvalSelectorError"
                            : "translationEvalSelectorHelp"
                        }
                        aria-invalid={invalid || undefined}
                        className="min-h-11"
                      />
                      <form.Subscribe selector={(state) => state.isSubmitting}>
                        {(isSubmitting) => {
                          const pending = isSubmitting || queueing;
                          return (
                            <Button type="submit" className="min-h-11" disabled={pending}>
                              {pending ? <Spinner /> : null}
                              {pending ? "Queueing…" : "Run check"}
                            </Button>
                          );
                        }}
                      </form.Subscribe>
                    </div>
                    {invalid ? (
                      <FieldError
                        id="translationEvalSelectorError"
                        errors={field.state.meta.errors}
                      />
                    ) : null}
                  </Field>
                );
              }}
            </form.Field>
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
        onRunAgain={(nextSelector) => {
          form.setFieldValue("chapterSelector", nextSelector);
          void form.handleSubmit({ closeReview: true });
        }}
        queueing={queueing}
      />
    </>
  );
}
