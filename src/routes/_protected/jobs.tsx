import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
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

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Metric label="Active translations" value={data.summary.activeTranslationJobs} />
        <Metric label="Failed translations" value={data.summary.failedTranslationJobs} />
        <Metric label="Active imports" value={data.summary.activeImportJobs} />
        <Metric label="Failed imports" value={data.summary.failedImportJobs} />
        <Metric label="Avg chunk latency" value={`${data.summary.avgChunkLatencyMs}ms`} />
        <Metric label="Tokens" value={data.summary.promptTokens + data.summary.completionTokens} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent translation jobs</CardTitle>
          <CardDescription>Latest 25 jobs across your novels.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-caption">
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
                  <td className="py-2 pr-3">
                    <Link
                      to="/novels/$novelId"
                      params={{ novelId: job.novelId }}
                      className="no-underline hover:text-muted-foreground"
                    >
                      {job.novelTitle}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    Ch. {job.chapterNumber} — {job.chapterTitle}
                  </td>
                  <td className="py-2 pr-3">
                    {job.doneChunks}/{job.totalChunks}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(job.updatedAt)}</td>
                  <td className="max-w-[260px] truncate py-2 pr-3 text-muted-foreground">
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
          <table className="w-full min-w-[760px] text-left text-caption">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Novel</th>
                <th className="py-2 pr-3 font-semibold">Range</th>
                <th className="py-2 pr-3 font-semibold">Provider</th>
                <th className="py-2 pr-3 font-semibold">Added / skipped / failed</th>
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
                  <td className="py-2 pr-3">{job.novelTitle}</td>
                  <td className="py-2 pr-3">
                    {job.fromNumber}–{job.toNumber}
                  </td>
                  <td className="py-2 pr-3">{job.scrapeProvider}</td>
                  <td className="py-2 pr-3">
                    {job.added} / {job.skipped} / {job.failed}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(job.updatedAt)}</td>
                  <td className="max-w-[260px] truncate py-2 pr-3 text-muted-foreground">
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-section font-semibold text-foreground">{value}</div>
        <div className="mt-1 text-caption text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "error" ? "destructive" : status === "done" ? "secondary" : "default";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString();
}
