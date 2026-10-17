import { useEffect, useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";

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
import { JobErrorText } from "@/components/jobs/job-error-text";
import { StatusBadge } from "@/components/jobs/status-badge";
import { formatNumber } from "@/lib/i18n/format";
import {
  createJobHistoryColumns,
  type JobHistoryColumnActions,
  jobHistoryColumnCopy,
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

const sortableSearchColumns: Record<string, JobHistorySearch["sort"]> = {
  novelTitle: "novelTitle",
  type: "type",
  status: "status",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
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
  const t = useTranslations("jobs");
  if (!visible) return null;
  return (
    <QueryErrorState
      title={t("updateFailed")}
      error={error}
      onRetry={onRetry}
      className="m-3 min-h-0 sm:m-4"
    />
  );
}

/**
 * The row as a phone reads it: the same facts as the table, stacked.
 *
 * It keeps its own wording for the second line — a full "Chapter 12" rather than the
 * column's "Ch. 12" — because the row has the width for the word and the table does not.
 */
function JobHistoryMobileRows({
  rows,
  actions,
  pendingJobId,
}: {
  rows: JobHistoryRow[];
  actions: Omit<JobHistoryColumnActions, "pendingJobId">;
  pendingJobId: string | null;
}) {
  const t = useTranslations("jobs");
  const locale = useLocale();
  const copy = useMemo(() => jobHistoryColumnCopy(t), [t]);

  return (
    <>
      {rows.map((job) => {
        const pending = pendingJobId === job.id;
        const secondaryLine =
          job.type === "translation"
            ? t("mobileChapter", { number: job.chapterNumber, title: job.chapterTitle })
            : copy.secondaryLine(job);
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
                <p className="mt-1 truncate text-caption text-muted-foreground">{secondaryLine}</p>
                {job.type === "translation" ? (
                  <p className="mt-0.5 truncate text-caption text-muted-foreground">
                    {copy.runtime(job)}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <Badge variant="outline">{copy.type[job.type]}</Badge>
                <StatusBadge status={job.status} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>{copy.headers.progress}</span>
                <span className="tabular-nums">
                  {job.progress.preparing
                    ? copy.preparing
                    : `${formatNumber(job.progress.completed, locale)} / ${formatNumber(job.progress.total, locale)}`}
                </span>
              </div>
              <Progress
                value={job.progress.percent}
                aria-label={copy.progressAria(job.progress.percent)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {copy.headers.updatedAt}
                <DateCell value={job.updatedAt} />
              </span>
              {job.error ? <JobErrorText message={job.error} /> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" variant="outline" onClick={() => actions.onCopyJobId(job)}>
                {copy.menu.copyJobId}
              </Button>
              <Button size="lg" variant="outline" onClick={() => actions.onViewDetails(job)}>
                {copy.details}
              </Button>
              <Button size="lg" variant="outline" onClick={() => actions.onOpenNovel(job.novelId)}>
                {t("mobileOpenNovel")}
              </Button>
              {job.type === "translation" ? (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => actions.onOpenChapter(job as JobHistoryTranslationRow)}
                >
                  {t("mobileOpenChapter")}
                </Button>
              ) : null}
              {job.canCancel ? (
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => actions.onCancel(job)}
                >
                  {pending ? copy.menu.working : copy.menu.cancelJob}
                </Button>
              ) : job.canRetry ? (
                <Button size="lg" disabled={pending} onClick={() => actions.onRetry(job)}>
                  {pending ? copy.menu.working : copy.menu.retryJob}
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
  const t = useTranslations("jobs");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { page: history, isPending, isFetching, isPlaceholderData, isError, error } = query;

  useEffect(() => {
    if (!history || isFetching || isPlaceholderData || history.page === search.page) return;
    onSearchChange({ page: history.page }, true);
  }, [history, isFetching, isPlaceholderData, onSearchChange, search.page]);

  const copy = useMemo(() => jobHistoryColumnCopy(t), [t]);
  const columns = useMemo(
    () => createJobHistoryColumns({ ...actions, pendingJobId }, copy, locale),
    [actions, copy, locale, pendingJobId],
  );
  const data = history?.rows ?? EMPTY_JOB_HISTORY_ROWS;
  const rowCount = history?.rowCount ?? 0;
  const currentPage = history?.page ?? search.page;
  const clearFilters = () => onSearchChange(CLEAR_JOB_FILTERS, true);
  const typeItems = {
    all: t("filterAllTypes"),
    translation: t("filterTranslations"),
    scrape: t("filterScrapes"),
    epub: t("typeEpub"),
  };
  const statusItems = {
    all: t("filterAllStatuses"),
    pending: t("statusPending"),
    running: t("statusRunning"),
    done: t("statusDone"),
    error: t("statusError"),
    cancelled: t("statusCancelled"),
  };

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
      <QueryErrorState title={t("loadFailed")} error={error} onRetry={onRetry} className="my-0" />
    );
  }
  return (
    <DataTableSection ariaLabel={t("sectionAria")} busy={isFetching}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel={t("searchLabel")}
        searchPlaceholder={t("searchPlaceholder")}
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={[
          {
            triggerId: "job-history-type",
            ariaLabel: t("filterByType"),
            value: search.type,
            items: typeItems,
            onChange: (value) =>
              onSearchChange({ type: value as JobHistorySearch["type"], page: 1 }, true),
          },
          {
            triggerId: "job-history-status",
            ariaLabel: t("filterByStatus"),
            value: search.status,
            items: statusItems,
            onChange: (value) =>
              onSearchChange({ status: value as JobHistorySearch["status"], page: 1 }, true),
          },
        ]}
        columns={{ table, labels: { ...copy.headers, actions: t("columnActions") } }}
        clearLabel={tCommon("clearFilters")}
        filtered={filtered}
        onClearFilters={clearFilters}
        description={t("tableDescription")}
        query={{ isFetching, isPlaceholderData }}
        busyMessage={t("loadingPage")}
      />

      <JobHistoryUpdateError
        visible={isError && Boolean(history)}
        error={error}
        onRetry={onRetry}
      />

      <DataTableMobileRegion ariaLabel={noRows || isPending ? undefined : t("mobileAria")}>
        {isPending && !history ? (
          <DataTableMobileLoading message={t("loadingJobs")} />
        ) : noRows ? (
          <DataTableMobileEmpty
            filtered={filtered}
            emptyTitle={t("emptyTitle")}
            filteredTitle={t("filteredTitle")}
            emptyDescription={t("emptyMobileDescription")}
            filteredDescription={t("filteredMobileDescription")}
            onClearFilters={clearFilters}
          />
        ) : (
          <JobHistoryMobileRows rows={data} actions={actions} pendingJobId={pendingJobId} />
        )}
      </DataTableMobileRegion>

      <DataTableDesktopRegion ariaLabel={t("desktopAria")} scroll>
        <Table className="min-w-[1080px] text-caption">
          <TableHeader className="sticky top-0 z-10 bg-muted/20">
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
            emptyTitle={t("emptyTitle")}
            filteredTitle={t("filteredTitle")}
            emptyDescription={t("emptyDesktopDescription")}
            filteredDescription={t("filteredDesktopDescription")}
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
        noun={t("nounJobs")}
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
