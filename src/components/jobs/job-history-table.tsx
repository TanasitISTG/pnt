import { useEffect, useMemo } from "react";

import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTableBody,
  DataTableCells,
  DataTableDesktopRegion,
  DataTableHeaderGroups,
  DataTableMobileEmpty,
  DataTableMobileLoading,
  DataTableMobileRegion,
  DataTablePagination,
  DataTableSection,
  DataTableToolbar,
} from "@/components/ui/data-table-parts";
import { Progress } from "@/components/ui/progress";
import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable } from "@/components/ui/use-data-table";
import type {
  JobHistoryPage,
  JobHistoryRow,
  JobHistorySearch,
  JobHistoryTranslationRow,
} from "@/lib/job-dashboard/contracts";
import { DateCell } from "@/components/jobs/date-cell";
import { StatusBadge } from "@/components/jobs/status-badge";
import {
  createJobHistoryColumns,
  type JobHistoryColumnActions,
  translationRuntime,
  typeLabels,
} from "./job-history-columns";

export type JobHistorySearchChange = (
  changes: Partial<JobHistorySearch>,
  replace?: boolean,
) => void;

export interface JobHistoryTableQueryState {
  page: JobHistoryPage | undefined;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isError: boolean;
  error: unknown;
}

export interface JobHistoryTableProps {
  query: JobHistoryTableQueryState;
  search: JobHistorySearch;
  onRetry: () => void;
  onSearchChange: JobHistorySearchChange;
  actions: Omit<JobHistoryColumnActions, "pendingJobId">;
  pendingJobId: string | null;
}

const columnLabels: Record<string, string> = {
  novelTitle: "Job",
  type: "Type",
  status: "Status",
  progress: "Progress",
  createdAt: "Started",
  updatedAt: "Updated",
  error: "Error",
  actions: "Actions",
};

const sortableSearchColumns: Record<string, JobHistorySearch["sort"]> = {
  novelTitle: "novelTitle",
  type: "type",
  status: "status",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const jobTypeItems: Record<string, string> = {
  all: "All types",
  translation: "Translations",
  scrape: "Scrapes",
  epub: "EPUB",
};

const jobStatusItems: Record<string, string> = {
  all: "All statuses",
  pending: "Pending",
  running: "Running",
  done: "Completed",
  error: "Failed",
  cancelled: "Cancelled",
};

const pageSizeOptions = [10, 25, 50] as const;

const EMPTY_JOB_HISTORY_ROWS: JobHistoryPage["rows"] = [];

function hasActiveFilters(search: JobHistorySearch) {
  return search.q !== "" || search.type !== "all" || search.status !== "all";
}

const CLEAR_JOB_FILTERS: Partial<JobHistorySearch> = {
  q: "",
  type: "all",
  status: "all",
  sort: "updatedAt",
  dir: "desc",
  page: 1,
};

function JobHistoryUpdateError({
  visible,
  error,
  onRetry,
}: {
  visible: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (!visible) return null;
  return (
    <QueryErrorState
      title="Unable to update job history"
      error={error}
      onRetry={onRetry}
      className="m-3 min-h-0 sm:m-4"
    />
  );
}

function mobileJobSecondaryLine(job: JobHistoryRow): string {
  if (job.type === "translation") return `Chapter ${job.chapterNumber} · ${job.chapterTitle}`;
  if (job.type === "scrape") return `Chapters ${job.fromNumber}–${job.toNumber}`;
  return job.sourceFileName ? `EPUB · ${job.sourceFileName}` : "EPUB import";
}

function JobHistoryMobileRows({
  rows,
  actions,
  pendingJobId,
}: {
  rows: JobHistoryRow[];
  actions: Omit<JobHistoryColumnActions, "pendingJobId">;
  pendingJobId: string | null;
}) {
  return (
    <>
      {rows.map((job) => {
        const pending = pendingJobId === job.id;
        return (
          <article key={job.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  className="block max-w-full truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => actions.onOpenNovel(job.novelId)}
                  title={job.novelTitle}
                >
                  {job.novelTitle}
                </button>
                <p className="mt-1 truncate text-caption text-muted-foreground">
                  {mobileJobSecondaryLine(job)}
                </p>
                {job.type === "translation" ? (
                  <p
                    className="mt-0.5 truncate text-caption text-muted-foreground"
                    title={`Runtime · ${translationRuntime(job)}`}
                  >
                    Runtime · {translationRuntime(job)}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <Badge variant="outline">{typeLabels[job.type]}</Badge>
                <StatusBadge status={job.status} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>Progress</span>
                <span className="tabular-nums">
                  {job.progress.preparing
                    ? "Preparing…"
                    : `${job.progress.completed.toLocaleString()} / ${job.progress.total.toLocaleString()}`}
                </span>
              </div>
              <Progress
                value={job.progress.percent}
                aria-label={`${job.progress.percent}% complete`}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
              <span>
                Updated <DateCell value={job.updatedAt} />
              </span>
              {job.error ? (
                <span className="max-w-full truncate text-destructive" title={job.error}>
                  {job.error}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => actions.onCopyJobId(job)}
              >
                Copy job ID
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => actions.onViewDetails(job)}
              >
                Details
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() => actions.onOpenNovel(job.novelId)}
              >
                Novel
              </Button>
              {job.type === "translation" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => actions.onOpenChapter(job as JobHistoryTranslationRow)}
                >
                  Chapter
                </Button>
              ) : null}
              {job.canCancel ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => actions.onCancel(job)}
                >
                  {pending ? "Working…" : "Cancel job"}
                </Button>
              ) : job.canRetry ? (
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => actions.onRetry(job)}
                >
                  {pending ? "Working…" : "Retry job"}
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </>
  );
}

export function JobHistoryTable({
  query,
  search,
  onRetry,
  onSearchChange,
  actions,
  pendingJobId,
}: JobHistoryTableProps) {
  const { page: history, isPending, isFetching, isPlaceholderData, isError, error } = query;

  useEffect(() => {
    if (!history || isFetching || isPlaceholderData || history.page === search.page) return;
    onSearchChange({ page: history.page }, true);
  }, [history, isFetching, isPlaceholderData, onSearchChange, search.page]);

  const columns = useMemo(
    () => createJobHistoryColumns({ ...actions, pendingJobId }),
    [actions, pendingJobId],
  );
  const data = history?.rows ?? EMPTY_JOB_HISTORY_ROWS;
  const rowCount = history?.rowCount ?? 0;
  const currentPage = history?.page ?? search.page;
  const clearFilters = () => onSearchChange(CLEAR_JOB_FILTERS, true);

  const { table } = useDataTable({
    columns,
    data,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    getRowId: (row) => row.id,
    initialColumnVisibility: { createdAt: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) =>
      onSearchChange({ sort: sort as JobHistorySearch["sort"], dir, page: 1 }, true),
  });

  const filtered = hasActiveFilters(search);
  const noRows = Boolean(history && !isFetching && data.length === 0);
  const paginationBusy = isPlaceholderData || (isPending && !history);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : firstRow + data.length - 1;
  const renderedRows = table.getRowModel().rows.map((row) => (
    <TableRow key={row.id} className="h-[4.25rem]">
      <DataTableCells
        cells={row.getVisibleCells()}
        renderCell={(cell) => <table.FlexRender cell={cell} />}
      />
    </TableRow>
  ));

  if (isError && !history) {
    return (
      <QueryErrorState
        title="Unable to load job history"
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }
  return (
    <DataTableSection ariaLabel="Job history" busy={isFetching}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel="Search job history"
        searchPlaceholder="Search novel, chapter, source, or job ID"
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={[
          {
            triggerId: "job-history-type",
            ariaLabel: "Filter by type",
            value: search.type,
            items: jobTypeItems,
            onChange: (value) =>
              onSearchChange({ type: value as JobHistorySearch["type"], page: 1 }, true),
          },
          {
            triggerId: "job-history-status",
            ariaLabel: "Filter by status",
            value: search.status,
            items: jobStatusItems,
            onChange: (value) =>
              onSearchChange({ status: value as JobHistorySearch["status"], page: 1 }, true),
          },
        ]}
        columns={{ table, labels: columnLabels }}
        clearLabel="Clear filters"
        filtered={filtered}
        onClearFilters={clearFilters}
        description="All retained translation and import runs"
        query={{ isFetching, isPlaceholderData }}
        busyMessage="Loading job page…"
      />

      <JobHistoryUpdateError
        visible={isError && Boolean(history)}
        error={error}
        onRetry={onRetry}
      />

      <DataTableMobileRegion ariaLabel={noRows || isPending ? undefined : "Mobile job history"}>
        {isPending && !history ? (
          <DataTableMobileLoading message="Loading jobs…" />
        ) : noRows ? (
          <DataTableMobileEmpty
            filtered={filtered}
            emptyTitle="No jobs yet"
            filteredTitle="No jobs match these filters"
            emptyDescription="Translation and import runs will appear here."
            filteredDescription="Try a different search or clear the filters."
            onClearFilters={clearFilters}
          />
        ) : (
          <JobHistoryMobileRows rows={data} actions={actions} pendingJobId={pendingJobId} />
        )}
      </DataTableMobileRegion>

      <DataTableDesktopRegion ariaLabel="Desktop job history">
        <Table className="min-w-[1080px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <DataTableBody
            initialLoading={isPending && !history}
            noRows={noRows}
            filtered={filtered}
            visibleColumnCount={visibleColumnCount}
            rows={renderedRows}
            emptyTitle="No jobs yet"
            filteredTitle="No jobs match these filters"
            emptyDescription="Translation and import runs will appear here as they are created."
            filteredDescription="Try a different search or clear the filters to see all retained runs."
            onClearFilters={clearFilters}
          />
        </Table>
      </DataTableDesktopRegion>

      <DataTablePagination
        table={table}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={paginationBusy}
        pageSize={search.pageSize}
        pageSizeOptions={pageSizeOptions}
        noun="jobs"
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
