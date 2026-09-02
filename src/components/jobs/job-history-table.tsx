import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const pageSizeItems: Record<string, string> = {
  "10": "10",
  "25": "25",
  "50": "50",
};

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

function SkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, skeletonIndex) => (
        <TableRow key={`skeleton-${skeletonIndex}`} aria-hidden="true">
          {Array.from({ length: columnCount }, (_cellPlaceholder, cellIndex) => (
            <TableCell key={`skeleton-${skeletonIndex}-${cellIndex}`}>
              <div className="h-4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </TableCell>
          ))}
        </TableRow>
      ))}
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
  const data = history?.rows ?? [];

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
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : firstRow + data.length - 1;
  const filtered = hasActiveFilters(search);
  const noRows = Boolean(history && !isFetching && data.length === 0);
  const paginationBusy = isPlaceholderData || (isPending && !history);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filterColumns: JobHistoryFilterColumn[] = [];
  for (const column of table.getAllLeafColumns()) {
    if (!column.getCanHide()) continue;
    filterColumns.push({
      id: column.id,
      label: columnLabels[column.id] ?? column.id,
      checked: column.getIsVisible(),
      onCheckedChange: (checked) => column.toggleVisibility(checked),
    });
  }

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
      {isError && history && (
        <QueryErrorState
          title="Unable to update job history"
          error={error}
          onRetry={onRetry}
          className="m-3 min-h-0 sm:m-4"
        />
      )}

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
          <TableBody>
            {isPending && !history ? (
              <SkeletonRows columnCount={visibleColumnCount} />
            ) : noRows ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-56 px-6 text-center">
                  <div className="mx-auto max-w-sm">
                    <p className="font-medium text-foreground">
                      {filtered ? "No jobs match these filters" : "No jobs yet"}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {filtered
                        ? "Try a different search or clear the filters to see all retained runs."
                        : "Translation and import runs will appear here as they are created."}
                    </p>
                    {filtered && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() =>
                          onSearchChange(
                            {
                              q: "",
                              type: "all",
                              status: "all",
                              sort: "updatedAt",
                              dir: "desc",
                              page: 1,
                            },
                            true,
                          )
                        }
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-3 py-2 ${
                        cell.column.id === "actions"
                          ? "sticky right-0 z-10 border-l border-border bg-card"
                          : ""
                      }`}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="tabular-nums">{formatRange(firstRow, lastRow, rowCount)}</div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <Select
              value={String(search.pageSize)}
              items={pageSizeItems}
              onValueChange={(value) => {
                const pageSize = Number(value);
                if (pageSizeOptions.includes(pageSize as (typeof pageSizeOptions)[number])) {
                  onSearchChange(
                    { pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 },
                    true,
                  );
                }
              }}
            >
              <SelectTrigger aria-label="Rows per page" className="h-9 w-[76px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={String(pageSize)}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage() || paginationBusy}
              aria-label="First page"
            >
              <ChevronsLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || paginationBusy}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span className="min-w-16 px-1 text-center tabular-nums text-foreground">
              Page {currentPage} of {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage() || paginationBusy}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.lastPage()}
              disabled={!table.getCanLastPage() || paginationBusy}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
