import { useQuery } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import type { ReactNode } from "react";

import { DateCell } from "@/components/jobs/date-cell";
import { StatusBadge } from "@/components/jobs/status-badge";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getImportJobStatus } from "@/lib/scrape/functions";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";

export interface ImportJobDetailsDialogProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
interface ImportJobDetails {
  id: string;
  novelTitle: string;
  kind: "scrape" | "epub";
  status: string;
  sourceFileName?: string | null;
  scrapeProvider?: string | null;
  baseUrl?: string | null;
  fromNumber: number;
  toNumber: number;
  nextNumber: number;
  added: number;
  skipped: number;
  failed: number;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function getImportProgress(job: ImportJobDetails) {
  const processed = job.added + job.skipped + job.failed;
  if (job.toNumber === 0) {
    return { label: "Preparing…", percent: 0 };
  }
  const total = job.kind === "epub" ? job.toNumber : Math.max(0, job.toNumber - job.fromNumber + 1);
  return {
    label: `${processed} / ${total}`,
    percent: Math.min(100, Math.round((processed / Math.max(1, total)) * 100)),
  };
}

function ImportJobDetailsContent({ job, updating }: { job: ImportJobDetails; updating: boolean }) {
  const progress = getImportProgress(job);
  const source =
    job.kind === "epub"
      ? job.sourceFileName || "EPUB upload"
      : `${job.scrapeProvider || "Unknown provider"} · ${job.baseUrl}`;
  const chapterRange =
    job.kind === "epub" && job.toNumber === 0 ? "Preparing…" : `${job.fromNumber}–${job.toNumber}`;
  const showReupload =
    job.kind === "epub" && (job.status === "error" || job.status === "cancelled");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={job.status as JobHistoryStatus} />
        <Badge variant="outline">{job.kind === "epub" ? "EPUB" : "Scrape"}</Badge>
        {updating ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Updating…
          </span>
        ) : null}
      </div>
      <dl className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
        <Detail label="Novel" value={job.novelTitle} />
        <Detail label="Job ID" value={job.id} mono />
        <Detail label="Source" value={source} breakWords />
        <Detail label="Chapter range" value={chapterRange} />
        <Detail label="Started" value={<DateCell value={job.createdAt} />} />
        <Detail label="Updated" value={<DateCell value={job.updatedAt} />} />
      </dl>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="font-medium text-foreground">Processing</span>
          <span className="tabular-nums text-muted-foreground">{progress.label}</span>
        </div>
        <Progress value={progress.percent} aria-label="Import processing progress" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Counter label="Added" value={job.added} />
        <Counter label="Skipped" value={job.skipped} />
        <Counter label="Failed" value={job.failed} />
      </div>
      {job.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-caption text-destructive">
          <p className="font-semibold">Worker error</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{job.error}</p>
        </div>
      ) : null}
      {showReupload ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-caption text-muted-foreground">
          <Upload className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Re-upload the EPUB from the novel page to retry.</p>
        </div>
      ) : null}
    </div>
  );
}

interface ImportDialogBodyProps {
  job: ImportJobDetails | null | undefined;
  loading: boolean;
  updating: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

function ImportDialogBody({
  job,
  loading,
  updating,
  isError,
  error,
  onRetry,
}: ImportDialogBodyProps) {
  if (loading) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-7 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <p>Loading job details…</p>
      </div>
    );
  }
  if (isError && !job) {
    return (
      <QueryErrorState
        title="Unable to load import details"
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }
  if (!job) {
    return (
      <div className="flex min-h-48 items-center justify-center text-center text-muted-foreground">
        Job details not found.
      </div>
    );
  }
  return <ImportJobDetailsContent job={job} updating={updating} />;
}

export function ImportJobDetailsDialog({ jobId, open, onOpenChange }: ImportJobDetailsDialogProps) {
  const jobQuery = useQuery({
    queryKey: ["import-job-details", jobId],
    queryFn: () => getImportJobStatus({ data: { jobId: jobId! } }),
    enabled: open && jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1_500 : false;
    },
  });

  if (!open || jobId === null) return null;

  const job = jobQuery.data;
  const isLoading = jobQuery.isPending && !job;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Import job details</DialogTitle>
          <DialogDescription>
            Inspect the source, range, counters, and worker result for this import run.
          </DialogDescription>
        </DialogHeader>

        <ImportDialogBody
          job={job}
          loading={isLoading}
          updating={jobQuery.isFetching}
          isError={jobQuery.isError}
          error={jobQuery.error}
          onRetry={() => void jobQuery.refetch()}
        />
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  value,
  mono = false,
  breakWords = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  breakWords?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 text-caption text-foreground ${mono ? "font-mono" : ""} ${breakWords ? "break-words" : "truncate"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-2 py-3">
      <div className="font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
