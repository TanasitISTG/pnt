import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { listTranslationEvalReports, startTranslationEval } from "@/lib/translation/eval.functions";
import { formatLocalDateTime } from "@/lib/date-time";
export function TranslationQualityPanel({ novelId }: { novelId: string }) {
  const queryClient = useQueryClient();
  const [selector, setSelector] = useState("first3");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data: reports = [] } = useQuery({
    queryKey: ["translation-eval-reports", novelId],
    queryFn: () => listTranslationEvalReports({ data: { novelId } }),
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "pending" || r.status === "running")
        ? 3000
        : false,
  });
  const latest = reports[0];

  const { mutate: runEval, isPending } = useMutation({
    mutationFn: () => startTranslationEval({ data: { novelId, chapterSelector: selector } }),
    onSuccess: () => {
      toast.success("Quality eval queued");
      queryClient.invalidateQueries({ queryKey: ["translation-eval-reports", novelId] });
    },
    onError: (error) => toast.error(error.message || "Failed to queue eval"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translation quality</CardTitle>
        <CardDescription>
          Inngest-backed eval over translated content. Selector accepts <code>first3</code>,{" "}
          <code>all</code>, or ranges like <code>1,2,5-8</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Label htmlFor="translationEvalSelector" className="sr-only">
            Chapter selector
          </Label>
          <Input
            id="translationEvalSelector"
            value={selector}
            onChange={(event) => setSelector(event.target.value)}
          />
          <Button onClick={() => runEval()} disabled={isPending}>
            {isPending ? "Queueing…" : "Run eval"}
          </Button>
        </div>

        {latest ? (
          <div className="grid gap-3 md:grid-cols-5">
            <QualityMetric label="Status" value={<Badge>{latest.status}</Badge>} />
            <QualityMetric label="Chapters" value={latest.chapterCount} />
            <QualityMetric label="Residual CJK" value={latest.residualCjk} />
            <QualityMetric label="Paragraph mismatch" value={latest.markerMismatches} />
            <QualityMetric
              label="Glossary adherence"
              value={
                latest.matchedGlossaryTerms > 0
                  ? `${Math.round((latest.adheredGlossaryTerms / latest.matchedGlossaryTerms) * 100)}%`
                  : "—"
              }
            />
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">No eval reports yet.</p>
        )}

        {reports.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-caption">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Created</th>
                  <th className="py-2 pr-3 font-semibold">Selector</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Residual</th>
                  <th className="py-2 pr-3 font-semibold">Mismatch</th>
                  <th className="py-2 pr-3 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {mounted ? formatLocalDateTime(report.createdAt) : "—"}
                    </td>
                    <td className="py-2 pr-3">{report.chapterSelector}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={report.status === "error" ? "destructive" : "secondary"}>
                        {report.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{report.residualCjk}</td>
                    <td className="py-2 pr-3">{report.markerMismatches}</td>
                    <td className="max-w-[260px] truncate py-2 pr-3 text-muted-foreground">
                      {report.error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QualityMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-card-title font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-caption text-muted-foreground">{label}</div>
    </div>
  );
}
