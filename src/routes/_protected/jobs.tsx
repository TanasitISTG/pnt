import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { DateCell } from "@/components/jobs/date-cell";
import { Metric } from "@/components/jobs/metric";
import { StatusBadge } from "@/components/jobs/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getJobDashboard } from "@/lib/job-observability.functions";

export const Route = createFileRoute("/_protected/jobs")({
  loader: async () => getJobDashboard(),
  component: JobsPage,
});

function JobsPage() {
  const initial = Route.useLoaderData();
  const {
    data = initial,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["job-dashboard"],
    queryFn: () => getJobDashboard(),
    initialData: initial,
    refetchInterval: 5000,
  });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const totalTokens = Number(data.summary.promptTokens) + Number(data.summary.completionTokens);
  const compactTokenCount = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(totalTokens),
    [totalTokens],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-display-alt font-semibold text-foreground">Jobs</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Translation and import health, recent failures, tokens, and chunk latency.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric label="Active translations" value={data.summary.activeTranslationJobs} />
        <Metric label="Failed translations" value={data.summary.failedTranslationJobs} />
        <Metric label="Active imports" value={data.summary.activeImportJobs} />
        <Metric label="Failed imports" value={data.summary.failedImportJobs} />
        <Metric label="Avg chunk latency" value={formatDuration(data.summary.avgChunkLatencyMs)} />
        <Metric label="Tokens" value={mounted ? compactTokenCount : totalTokens} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent translation jobs</CardTitle>
          <CardDescription>Latest 25 jobs across your novels.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-left text-caption">
            <colgroup>
              <col className="w-[86px]" />
              <col className="w-[270px]" />
              <col className="w-[230px]" />
              <col className="w-[70px]" />
              <col className="w-[150px]" />
              <col />
            </colgroup>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Novel</th>
                <th className="py-2 pr-3 font-semibold">Chapter</th>
                <th className="py-2 pr-3 font-semibold">Progress</th>
                <th className="py-2 pr-3 font-semibold">Updated</th>
                <th className="py-2 pr-3 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.translationJobs.map((job) => (
                <tr key={job.id}>
                  <td className="py-2 pr-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="truncate py-2 pr-3">
                    <Link
                      to="/novels/$novelId"
                      params={{ novelId: job.novelId }}
                      className="no-underline hover:text-muted-foreground"
                      title={job.novelTitle}
                    >
                      {job.novelTitle}
                    </Link>
                  </td>
                  <td
                    className="truncate py-2 pr-3"
                    title={`Ch. ${job.chapterNumber} — ${job.chapterTitle}`}
                  >
                    Ch. {job.chapterNumber} — {job.chapterTitle}
                  </td>
                  <td className="py-2 pr-3">
                    {job.doneChunks}/{job.totalChunks}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    <DateCell value={job.updatedAt} />
                  </td>
                  <td className="truncate py-2 pr-3 text-muted-foreground" title={job.error || ""}>
                    {job.error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent import jobs</CardTitle>
          <CardDescription>Bulk scrape/import runs.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-left text-caption">
            <colgroup>
              <col className="w-[86px]" />
              <col />
              <col className="w-[70px]" />
              <col className="w-[100px]" />
              <col className="w-[120px]" />
              <col className="w-[150px]" />
              <col className="w-[260px]" />
            </colgroup>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Novel</th>
                <th className="py-2 pr-3 font-semibold">Range</th>
                <th className="py-2 pr-3 font-semibold">Provider</th>
                <th className="py-2 pr-3 font-semibold">Result</th>
                <th className="py-2 pr-3 font-semibold">Updated</th>
                <th className="py-2 pr-3 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.importJobs.map((job) => (
                <tr key={job.id}>
                  <td className="py-2 pr-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="truncate py-2 pr-3" title={job.novelTitle}>
                    {job.novelTitle}
                  </td>
                  <td className="py-2 pr-3">
                    {job.kind === "epub"
                      ? job.toNumber === 0
                        ? "Preparing…"
                        : `1–${job.toNumber}`
                      : `${job.fromNumber}–${job.toNumber}`}
                  </td>
                  <td
                    className="truncate py-2 pr-3"
                    title={
                      job.kind === "epub"
                        ? job.sourceFileName
                          ? `EPUB — ${job.sourceFileName}`
                          : "EPUB"
                        : formatLabel(job.scrapeProvider)
                    }
                  >
                    {job.kind === "epub"
                      ? job.sourceFileName
                        ? `EPUB — ${job.sourceFileName}`
                        : "EPUB"
                      : formatLabel(job.scrapeProvider)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3" title="added / skipped / failed">
                    {job.added} / {job.skipped} / {job.failed}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                    <DateCell value={job.updatedAt} />
                  </td>
                  <td className="truncate py-2 pr-3 text-muted-foreground" title={job.error || ""}>
                    {job.error || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(value: number) {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}
