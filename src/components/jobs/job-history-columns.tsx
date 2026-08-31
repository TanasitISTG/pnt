import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal } from "lucide-react";
import {
  createColumnHelper,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type Column,
} from "@tanstack/react-table";

import { DateCell } from "@/components/jobs/date-cell";
import { StatusBadge } from "@/components/jobs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import type {
  JobHistoryRow,
  JobHistoryTranslationRow,
  JobHistoryType,
} from "@/lib/job-dashboard/contracts";

export const jobHistoryTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
});

type JobHistoryTableFeatures = typeof jobHistoryTableFeatures;
const columnHelper = createColumnHelper<JobHistoryTableFeatures, JobHistoryRow>();

export type JobHistoryColumnActions = {
  onViewDetails: (job: JobHistoryRow) => void;
  onOpenNovel: (novelId: string) => void;
  onOpenChapter: (job: JobHistoryTranslationRow) => void;
  onCopyJobId: (job: JobHistoryRow) => void;
  onCancel: (job: JobHistoryRow) => void;
  onRetry: (job: JobHistoryRow) => void;
  pendingJobId: string | null;
};

const typeLabels: Record<JobHistoryType, string> = {
  translation: "Translation",
  scrape: "Scrape",
  epub: "EPUB",
};

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<JobHistoryTableFeatures, JobHistoryRow, TValue>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-8 px-2 font-semibold text-muted-foreground hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="size-3.5" aria-hidden="true" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3.5" aria-hidden="true" />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
      )}
    </Button>
  );
}

function jobSecondaryLine(job: JobHistoryRow) {
  if (job.type === "translation") {
    return `Ch. ${job.chapterNumber} · ${job.chapterTitle}`;
  }
  if (job.type === "scrape") {
    return `Chapters ${job.fromNumber}–${job.toNumber}`;
  }
  return job.sourceFileName ? `EPUB · ${job.sourceFileName}` : "EPUB import";
}

function jobRange(job: JobHistoryRow) {
  if (job.type === "translation") return `${job.doneChunks}/${job.totalChunks} chunks`;
  if (job.type === "epub" && job.toNumber === 0) return "Preparing…";
  return `${job.fromNumber}–${job.toNumber}`;
}

function typeDetail(job: JobHistoryRow) {
  if (job.type === "translation") return "Chapter translation";
  if (job.type === "scrape") {
    return job.scrapeProvider ? `${job.scrapeProvider} · ${jobRange(job)}` : jobRange(job);
  }
  return jobRange(job);
}

export function createJobHistoryColumns(actions: JobHistoryColumnActions) {
  return columnHelper.columns([
    columnHelper.accessor("novelTitle", {
      id: "novelTitle",
      header: ({ column }) => <SortableHeader column={column} label="Job" />,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="min-w-[190px] max-w-[280px]">
            <button
              type="button"
              className="block max-w-full truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => actions.onOpenNovel(job.novelId)}
              title={job.novelTitle}
            >
              {job.novelTitle}
            </button>
            <p
              className="mt-0.5 truncate text-caption text-muted-foreground"
              title={jobSecondaryLine(job)}
            >
              {jobSecondaryLine(job)}
            </p>
          </div>
        );
      },
    }),
    columnHelper.accessor("type", {
      id: "type",
      header: ({ column }) => <SortableHeader column={column} label="Type" />,
      cell: ({ row }) => (
        <div className="min-w-[112px]">
          <Badge variant="outline" className="font-medium">
            {typeLabels[row.original.type]}
          </Badge>
          <p className="mt-1 text-[11px] text-muted-foreground">{typeDetail(row.original)}</p>
        </div>
      ),
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => <SortableHeader column={column} label="Status" />,
      cell: ({ row }) => (
        <div className="min-w-[100px]">
          <StatusBadge status={row.original.status} />
        </div>
      ),
    }),
    columnHelper.display({
      id: "progress",
      header: "Progress",
      enableSorting: false,
      cell: ({ row }) => {
        const { progress } = row.original;
        return (
          <div className="min-w-[132px] space-y-1.5">
            <Progress
              value={progress.percent}
              aria-label={`${progress.percent}% complete`}
              className="gap-0.5"
            />
            <span className="block text-caption tabular-nums text-muted-foreground">
              {progress.preparing
                ? "Preparing…"
                : `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      id: "createdAt",
      header: ({ column }) => <SortableHeader column={column} label="Started" />,
      cell: ({ row }) => <DateCell value={row.original.createdAt} />,
    }),
    columnHelper.accessor("updatedAt", {
      id: "updatedAt",
      header: ({ column }) => <SortableHeader column={column} label="Updated" />,
      cell: ({ row }) => <DateCell value={row.original.updatedAt} />,
    }),
    columnHelper.display({
      id: "error",
      header: "Error",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.error ? (
          <span
            className="block max-w-[240px] truncate text-caption text-destructive"
            title={row.original.error}
          >
            {row.original.error}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => {
        const job = row.original;
        const pending = actions.pendingJobId === job.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${job.novelTitle}`}
                />
              }
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Job actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => actions.onViewDetails(job)}>
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onOpenNovel(job.novelId)}>
                  Open novel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onCopyJobId(job)}>
                  Copy job ID
                </DropdownMenuItem>
                {job.type === "translation" && (
                  <DropdownMenuItem onClick={() => actions.onOpenChapter(job)}>
                    Open chapter
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {(job.canCancel || job.canRetry) && <DropdownMenuSeparator />}
              {job.canCancel && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={pending}
                  onClick={() => actions.onCancel(job)}
                >
                  {pending ? "Working…" : "Cancel job"}
                </DropdownMenuItem>
              )}
              {job.canRetry && (
                <DropdownMenuItem disabled={pending} onClick={() => actions.onRetry(job)}>
                  {pending ? "Working…" : "Retry job"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ]);
}

export { typeLabels };
