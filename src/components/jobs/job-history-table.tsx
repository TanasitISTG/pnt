import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import {
  DataTableEmptyState,
  DataTablePagination,
  DataTableSkeletonRows,
} from "@/components/ui/data-table-parts";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobHistoryFilters, type JobHistoryFilterColumn } from "./job-history-filters";
import type { JobHistoryPage, JobHistorySearch } from "@/lib/job-dashboard/contracts";
import {
  createJobHistoryColumns,
  jobHistoryTableFeatures,
  type JobHistoryColumnActions,
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

const pageSizeOptions = [10, 25, 50] as const;

const EMPTY_JOB_HISTORY_ROWS: JobHistoryPage["rows"] = [];

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  if (typeof updater === "function") return (updater as (old: T) => T)(current);
  return updater;
}

function hasActiveFilters(search: JobHistorySearch) {
  return search.q !== "" || search.type !== "all" || search.status !== "all";
}

function formatRange(first: number, last: number, total: number) {
  return total === 0
    ? "0 jobs"
    : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} jobs`;
}
interface JobHistoryVisibilityColumn {
  id: string;
  getCanHide: () => boolean;
  getIsVisible: () => boolean;
  toggleVisibility: (visible: boolean) => void;
}

function buildJobHistoryFilterColumns(
  columns: JobHistoryVisibilityColumn[],
): JobHistoryFilterColumn[] {
  const filterColumns: JobHistoryFilterColumn[] = [];
  for (const column of columns) {
    if (!column.getCanHide()) continue;
    filterColumns.push({
      id: column.id,
      label: columnLabels[column.id] ?? column.id,
      checked: column.getIsVisible(),
      onCheckedChange: (checked) => column.toggleVisibility(checked),
    });
  }
  return filterColumns;
}

function getJobHistoryRange(
  rowCount: number,
  currentPage: number,
  pageSize: number,
  pageRowCount: number,
) {
  if (rowCount === 0) return { firstRow: 0, lastRow: 0 };
  const firstRow = (currentPage - 1) * pageSize + 1;
  return { firstRow, lastRow: firstRow + pageRowCount - 1 };
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

interface JobHistoryBodyProps {
  initialLoading: boolean;
  noRows: boolean;
  filtered: boolean;
  visibleColumnCount: number;
  rows: ReactNode;
  onClearFilters: () => void;
}

function JobHistoryBody({
  initialLoading,
  noRows,
  filtered,
  visibleColumnCount,
  rows,
  onClearFilters,
}: JobHistoryBodyProps) {
  if (initialLoading) {
    return (
      <TableBody>
        <DataTableSkeletonRows columnCount={visibleColumnCount} />
      </TableBody>
    );
  }
  if (!noRows) return <TableBody>{rows}</TableBody>;
  return (
    <DataTableEmptyState
      columnCount={visibleColumnCount}
      filtered={filtered}
      emptyTitle="No jobs yet"
      filteredTitle="No jobs match these filters"
      emptyDescription="Translation and import runs will appear here as they are created."
      filteredDescription="Try a different search or clear the filters to see all retained runs."
      onClearFilters={onClearFilters}
    />
  );
}

interface JobHistoryPaginationTable {
  firstPage: () => void;
  previousPage: () => void;
  nextPage: () => void;
  lastPage: () => void;
  getCanPreviousPage: () => boolean;
  getCanNextPage: () => boolean;
  getCanLastPage: () => boolean;
  getPageCount: () => number;
}

interface JobHistoryPaginationProps {
  table: JobHistoryPaginationTable;
  search: JobHistorySearch;
  firstRow: number;
  lastRow: number;
  rowCount: number;
  currentPage: number;
  busy: boolean;
  onSearchChange: JobHistorySearchChange;
}

function JobHistoryPagination({
  table,
  search,
  firstRow,
  lastRow,
  rowCount,
  currentPage,
  busy,
  onSearchChange,
}: JobHistoryPaginationProps) {
  return (
    <DataTablePagination
      table={table}
      firstRow={firstRow}
      lastRow={lastRow}
      rowCount={rowCount}
      currentPage={currentPage}
      busy={busy}
      pageSize={search.pageSize}
      pageSizeOptions={pageSizeOptions}
      formatRange={formatRange}
      onPageSizeChange={(pageSize) =>
        onSearchChange({ pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 }, true)
      }
    />
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
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
    createdAt: false,
  });
  useEffect(() => {
    if (!history || isFetching || isPlaceholderData || history.page === search.page) return;
    onSearchChange({ page: history.page }, true);
  }, [history, isFetching, isPlaceholderData, onSearchChange, search.page]);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: Math.max(0, search.page - 1), pageSize: search.pageSize }),
    [search.page, search.pageSize],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: search.sort, desc: search.dir === "desc" }],
    [search.dir, search.sort],
  );
  const columns = useMemo(
    () => createJobHistoryColumns({ ...actions, pendingJobId }),
    [actions, pendingJobId],
  );
  const data = history?.rows ?? EMPTY_JOB_HISTORY_ROWS;

  const table = useTable({
    features: jobHistoryTableFeatures,
    columns,
    data,
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    rowCount: history?.rowCount ?? 0,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination);
      if (next.pageSize !== search.pageSize) {
        onSearchChange({ pageSize: next.pageSize as JobHistorySearch["pageSize"], page: 1 }, true);
        return;
      }
      const nextPage = next.pageIndex + 1;
      if (nextPage !== search.page) onSearchChange({ page: nextPage }, false);
    },
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting);
      const selected = next[0];
      const sort = selected ? sortableSearchColumns[selected.id] : undefined;
      if (!sort) return;
      onSearchChange({ sort, dir: selected.desc ? "desc" : "asc", page: 1 }, true);
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const rowCount = history?.rowCount ?? 0;
  const currentPage = history?.page ?? search.page;
  const { firstRow, lastRow } = getJobHistoryRange(
    rowCount,
    currentPage,
    search.pageSize,
    data.length,
  );
  const filtered = hasActiveFilters(search);
  const noRows = Boolean(history && !isFetching && data.length === 0);
  const paginationBusy = isPlaceholderData || (isPending && !history);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filterColumns = buildJobHistoryFilterColumns(table.getAllLeafColumns());
  const renderedRows = table.getRowModel().rows.map((row) => (
    <TableRow key={row.id} className="h-[4.25rem]">
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={`px-3 py-2 ${
            cell.column.id === "actions" ? "sticky right-0 z-10 border-l border-border bg-card" : ""
          }`}
        >
          <table.FlexRender cell={cell} />
        </TableCell>
      ))}
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
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Job history"
      aria-busy={isFetching}
    >
      <JobHistoryFilters
        search={search}
        onSearchChange={onSearchChange}
        query={{ isFetching, isPlaceholderData }}
        columns={filterColumns}
      />
      <JobHistoryUpdateError
        visible={isError && Boolean(history)}
        error={error}
        onRetry={onRetry}
      />

      <div className="overflow-x-auto">
        <Table className="min-w-[1080px] text-caption">
          <TableHeader className="bg-muted/20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-11 px-3 ${
                      header.column.id === "actions"
                        ? "sticky right-0 z-10 border-l border-border bg-muted/20"
                        : ""
                    }`}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <JobHistoryBody
            initialLoading={isPending && !history}
            noRows={noRows}
            filtered={filtered}
            visibleColumnCount={visibleColumnCount}
            rows={renderedRows}
            onClearFilters={() => onSearchChange(CLEAR_JOB_FILTERS, true)}
          />
        </Table>
      </div>

      <JobHistoryPagination
        table={table}
        search={search}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={paginationBusy}
        onSearchChange={onSearchChange}
      />
    </section>
  );
}
