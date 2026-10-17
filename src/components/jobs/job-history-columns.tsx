import { MoreHorizontal } from "lucide-react";
import { createColumnHelper } from "@tanstack/react-table";
import type { useTranslations } from "use-intl";

import { JobErrorText } from "@/components/jobs/job-error-text";

import { DateCell } from "@/components/jobs/date-cell";
import { StatusBadge } from "@/components/jobs/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableSortableHeader } from "@/components/ui/data-table-parts";
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
import type { DataTableFeatures } from "@/components/ui/use-data-table";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type {
  JobHistoryRow,
  JobHistoryTranslationRow,
  JobHistoryType,
} from "@/lib/job-dashboard/contracts";

/**
 * The `jobs` translator, named so a column factory can take one as an argument. A factory is
 * not a component and cannot call a hook itself, and a key read through this type is still
 * checked against the catalog.
 */
export type JobsTranslator = ReturnType<typeof useTranslations<"jobs">>;

const columnHelper = createColumnHelper<DataTableFeatures, JobHistoryRow>();

export type JobHistoryColumnActions = {
  onViewDetails: (job: JobHistoryRow) => void;
  onOpenNovel: (novelId: string) => void;
  onOpenChapter: (job: JobHistoryTranslationRow) => void;
  onCopyJobId: (job: JobHistoryRow) => void;
  onCancel: (job: JobHistoryRow) => void;
  onRetry: (job: JobHistoryRow) => void;
  pendingJobId: string | null;
};

/**
 * Every word the columns render, resolved once.
 *
 * A column factory is not a component, so it cannot call a hook; the caller builds this
 * from a translator instead and the factory stays a pure function of the copy it is given.
 * The lead bands render the same type badge and the same second line as the table's rows,
 * so the builder is exported: one run reads the same in both places, and a word added to
 * one of them cannot drift from the other.
 */
export interface JobHistoryColumnCopy {
  type: Record<JobHistoryType, string>;
  /** The line under a novel's title: which chapter, which range, which file. */
  secondaryLine: (job: JobHistoryRow) => string;
  /** The model that runs a job, or the settings a legacy row falls back to. */
  runtime: (job: JobHistoryTranslationRow) => string;
  /** The type column's third line. */
  typeDetail: (job: JobHistoryRow) => string;
  /** The word a progress bar shows before it has a fraction to show. */
  preparing: string;
  /**
   * The band and phone row spell the same action shorter than the row menu does, because
   * they sit beside the row's own title rather than inside a list of actions.
   */
  details: string;
  /** How a progress bar announces itself. */
  progressAria: (percent: number) => string;
  headers: {
    novelTitle: string;
    type: string;
    status: string;
    progress: string;
    createdAt: string;
    updatedAt: string;
    error: string;
  };
  menu: {
    label: string;
    viewDetails: string;
    openNovel: string;
    copyJobId: string;
    openChapter: string;
    cancelJob: string;
    retryJob: string;
    working: string;
    /** The row menu's own name, which takes the novel's title. */
    actionsFor: (title: string) => string;
  };
}

export function jobHistoryColumnCopy(t: JobsTranslator): JobHistoryColumnCopy {
  const range = (job: JobHistoryRow) => {
    if (job.type === "translation") {
      return t("rangeChunks", { done: job.doneChunks, total: job.totalChunks });
    }
    if (job.type === "epub" && job.toNumber === 0) return t("preparing");
    return t("rangeChapters", { from: job.fromNumber, to: job.toNumber });
  };

  return {
    type: {
      translation: t("typeTranslation"),
      scrape: t("typeScrape"),
      epub: t("typeEpub"),
    },
    secondaryLine: (job) => {
      if (job.type === "translation") {
        return t("secondaryChapter", { number: job.chapterNumber, title: job.chapterTitle });
      }
      if (job.type === "scrape") {
        return t("secondaryScrapeRange", { from: job.fromNumber, to: job.toNumber });
      }
      return job.sourceFileName
        ? t("secondaryEpubFile", { fileName: job.sourceFileName })
        : t("secondaryEpubImport");
    },
    runtime: (job) => {
      // A provider and a model are names, and the separator between two names is not a
      // sentence: `runtimePrefix` carries the only words this line has.
      const runtime =
        job.isLegacyProviderFallback || job.provider === null || job.model === null
          ? t("runtimeLegacy")
          : `${job.provider} · ${job.model}`;
      return t("runtimePrefix", { runtime });
    },
    typeDetail: (job) => {
      if (job.type === "translation") return t("typeDetailTranslation");
      // The provider's name sits beside the range the same way: `Firecrawl · 1–10` is two
      // values, and the range is the only part of it the catalog has a word for.
      return job.type === "scrape" && job.scrapeProvider
        ? `${job.scrapeProvider} · ${range(job)}`
        : range(job);
    },
    preparing: t("preparing"),
    details: t("details"),
    progressAria: (percent) => t("progressPercent", { percent }),
    headers: {
      novelTitle: t("columnJob"),
      type: t("columnType"),
      status: t("columnStatus"),
      progress: t("columnProgress"),
      createdAt: t("columnStarted"),
      updatedAt: t("columnUpdated"),
      error: t("columnError"),
    },
    menu: {
      label: t("jobActions"),
      viewDetails: t("viewDetails"),
      openNovel: t("openNovel"),
      copyJobId: t("copyJobId"),
      openChapter: t("openChapter"),
      cancelJob: t("cancelJob"),
      retryJob: t("retryJob"),
      working: t("working"),
      actionsFor: (title) => t("actionsFor", { title }),
    },
  };
}

export function createJobHistoryColumns(
  actions: JobHistoryColumnActions,
  copy: JobHistoryColumnCopy,
  // A factory is not a component, so it cannot read the locale either: the caller that renders
  // the table passes its own, the way it passes the translator's words.
  locale: Locale,
) {
  return columnHelper.columns([
    columnHelper.accessor("novelTitle", {
      id: "novelTitle",
      header: ({ column }) => (
        <DataTableSortableHeader column={column} label={copy.headers.novelTitle} />
      ),
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
              title={copy.secondaryLine(job)}
            >
              {copy.secondaryLine(job)}
            </p>
          </div>
        );
      },
    }),
    columnHelper.accessor("type", {
      id: "type",
      header: ({ column }) => <DataTableSortableHeader column={column} label={copy.headers.type} />,
      cell: ({ row }) => {
        const job = row.original;
        return (
          <div className="min-w-[112px]">
            <Badge variant="outline" className="font-medium">
              {copy.type[job.type]}
            </Badge>
            <p className="mt-1 text-micro text-muted-foreground">{copy.typeDetail(job)}</p>
            {job.type === "translation" ? (
              <p
                className="mt-0.5 max-w-[180px] truncate text-micro text-muted-foreground"
                title={copy.runtime(job)}
              >
                {copy.runtime(job)}
              </p>
            ) : null}
          </div>
        );
      },
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => (
        <DataTableSortableHeader column={column} label={copy.headers.status} />
      ),
      cell: ({ row }) => (
        <div className="min-w-[100px]">
          <StatusBadge status={row.original.status} />
        </div>
      ),
    }),
    columnHelper.display({
      id: "progress",
      header: copy.headers.progress,
      enableSorting: false,
      cell: ({ row }) => {
        const { progress } = row.original;
        return (
          <div className="min-w-[132px] space-y-1.5">
            <Progress
              value={progress.percent}
              aria-label={copy.progressAria(progress.percent)}
              className="gap-0.5"
            />
            <span className="block text-caption tabular-nums text-muted-foreground">
              {progress.preparing
                ? copy.preparing
                : `${formatNumber(progress.completed, locale)} / ${formatNumber(progress.total, locale)}`}
            </span>
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      id: "createdAt",
      header: ({ column }) => (
        <DataTableSortableHeader column={column} label={copy.headers.createdAt} />
      ),
      cell: ({ row }) => <DateCell value={row.original.createdAt} />,
    }),
    columnHelper.accessor("updatedAt", {
      id: "updatedAt",
      header: ({ column }) => (
        <DataTableSortableHeader column={column} label={copy.headers.updatedAt} />
      ),
      cell: ({ row }) => <DateCell value={row.original.updatedAt} />,
    }),
    columnHelper.display({
      id: "error",
      header: copy.headers.error,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.error ? (
          <JobErrorText message={row.original.error} />
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
                  aria-label={copy.menu.actionsFor(job.novelTitle)}
                />
              }
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{copy.menu.label}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => actions.onViewDetails(job)}>
                  {copy.menu.viewDetails}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onOpenNovel(job.novelId)}>
                  {copy.menu.openNovel}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onCopyJobId(job)}>
                  {copy.menu.copyJobId}
                </DropdownMenuItem>
                {job.type === "translation" && (
                  <DropdownMenuItem onClick={() => actions.onOpenChapter(job)}>
                    {copy.menu.openChapter}
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
                  {pending ? copy.menu.working : copy.menu.cancelJob}
                </DropdownMenuItem>
              )}
              {job.canRetry && (
                <DropdownMenuItem disabled={pending} onClick={() => actions.onRetry(job)}>
                  {pending ? copy.menu.working : copy.menu.retryJob}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ]);
}
