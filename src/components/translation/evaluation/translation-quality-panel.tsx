import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";

import { QueryErrorState } from "@/components/query-error-state";
import { TranslationEvalReportDialog } from "@/components/translation/evaluation/translation-eval-report-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/i18n/format";
import { translateMessage } from "@/lib/i18n/server-error";
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

/**
 * The key a report's status is named by. The label is copy, so the badge asks the catalog for
 * it rather than holding an English word of its own — the second surface to show a status
 * reads it the same way.
 */
function statusKey(status: EvalReportSummary["status"]) {
  if (status === "pending") return "statusQueued" as const;
  if (status === "running") return "statusChecking" as const;
  if (status === "error") return "statusFailed" as const;
  return "statusComplete" as const;
}

/** The selector line's three examples, kept out of the render so the tag function is a stable
 * reference rather than a component minted on every render. */
const SELECTOR_HELP_TAGS = {
  code: (chunks: ReactNode) => <code>{chunks}</code>,
};

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
  const t = useTranslations("evaluation");
  // The report's failure is stored as a code by the worker, which has no reader's language, so
  // it is resolved here the way the report dialog resolves the same field.
  const tRoot = useTranslations();
  const locale = useLocale();
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{t("latestCheck")}</p>
            <Badge variant={statusVariant(report.status)}>{t(statusKey(report.status))}</Badge>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {report.chapterSelector} · {mounted ? formatDateTime(report.createdAt, locale) : "—"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="min-h-11" onClick={onView}>
          {report.status === "done" ? t("viewFindings") : t("viewCheck")}
        </Button>
      </div>

      {report.status === "error" ? (
        <p className="mt-3 text-sm text-destructive-text">
          {translateMessage(report.error ?? "", tRoot) ?? report.error}
        </p>
      ) : report.status !== "done" ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("autoUpdate")}</p>
      ) : report.meta ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <SummaryMetric label={t("metricSelected")} value={report.chapterCount} />
          <SummaryMetric label={t("metricEvaluated")} value={report.meta.evaluatedChapterCount} />
          <SummaryMetric label={t("metricNotTranslated")} value={report.meta.skippedChapterCount} />
          <SummaryMetric
            label={t("metricNeedsAttention")}
            value={report.meta.attentionChapterCount}
          />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("legacySummary", {
            chapters: report.chapterCount,
            letters: report.residualScriptLetters,
            paragraphs: report.markerMismatches,
            adhered: report.adheredGlossaryTerms,
            matched: report.matchedGlossaryTerms,
          })}
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
  const t = useTranslations("evaluation");
  const locale = useLocale();
  return (
    <details className="rounded-xl border border-border">
      <summary className="cursor-pointer list-inside px-4 py-3 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("history", { count: reports.length })}
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
                  {mounted ? formatDateTime(report.createdAt, locale) : "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(report.status)}>{t(statusKey(report.status))}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => onView(report)}
                >
                  {report.status === "done" ? t("viewFindings") : t("viewCheck")}
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
  const t = useTranslations("evaluation");
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
      toast.success(t("queued"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("queueFailed"));
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
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
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
                    <FieldLabel htmlFor="translationEvalSelector">{t("selectorLabel")}</FieldLabel>
                    <FieldDescription id="translationEvalSelectorHelp">
                      {t.rich("selectorHelp", SELECTOR_HELP_TAGS)}
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
                              {pending ? t("queueing") : t("runCheck")}
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
            <p className="text-sm text-muted-foreground">{t("loadingHistory")}</p>
          ) : null}

          {reportsQuery.isError ? (
            <QueryErrorState
              title={t("historyFailed")}
              error={reportsQuery.error}
              onRetry={() => void reportsQuery.refetch()}
              className="my-0 min-h-0"
            />
          ) : reports.length > 0 ? (
            <CheckHistory reports={reports} mounted={mounted} onView={viewReport} />
          ) : !reportsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
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
