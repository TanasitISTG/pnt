import { ChevronsUpDown, Columns3, Loader2, MoreHorizontal, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import { QueryErrorState } from "@/components/query-error-state";
import {
  DataTableEmptyState,
  DataTablePagination,
  DataTableSkeletonRows,
} from "@/components/ui/data-table-parts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import type {
  GlossaryListPage,
  GlossaryListRow,
  GlossaryListSearch,
  TermCategory,
  TermStatus,
} from "@/lib/glossary/schemas";

const glossaryTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
});

type GlossaryTableFeatures = typeof glossaryTableFeatures;
const columnHelper = createColumnHelper<GlossaryTableFeatures, GlossaryListRow>();
const EMPTY_GLOSSARY_ROWS: GlossaryListRow[] = [];

export type GlossarySearchChange = (
  changes: Partial<GlossaryListSearch>,
  replace?: boolean,
) => void;

export interface GlossaryTableActions {
  onEdit: (term: GlossaryListRow) => void;
  onDelete: (termId: string) => void;
  onApprove: (termId: string) => void;
  onReject: (termId: string) => void;
  pending: boolean;
}

export interface GlossaryTableQueryState {
  page: GlossaryListPage | undefined;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isError: boolean;
  error: unknown;
}

export interface GlossaryTableProps {
  query: GlossaryTableQueryState;
  search: GlossaryListSearch;
  onRetry: () => void;
  onSearchChange: GlossarySearchChange;
  actions: GlossaryTableActions;
}

const categoryItems: Record<string, string> = {
  all: "All categories",
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

const statusItems: Record<string, string> = {
  all: "All statuses",
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
};

const pageSizeOptions = [10, 25, 50] as const;
const columnLabels: Record<string, string> = {
  source: "Source",
  target: "Target",
  category: "Category",
  status: "Status",
  note: "Note",
  actions: "Actions",
};
const sortableSearchColumns: Record<string, GlossaryListSearch["sort"]> = {
  source: "source",
  target: "target",
  category: "category",
  status: "status",
};

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  if (typeof updater === "function") return (updater as (old: T) => T)(current);
  return updater;
}

function hasActiveFilters(search: GlossaryListSearch) {
  return search.q !== "" || search.category !== "all" || search.status !== "approved";
}

function formatRange(first: number, last: number, total: number) {
  return total === 0
    ? "0 terms"
    : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} terms`;
}

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<GlossaryTableFeatures, GlossaryListRow, TValue>;
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
        <ChevronsUpDown className="size-3.5" aria-hidden="true" />
      ) : sorted === "desc" ? (
        <ChevronsUpDown className="size-3.5 rotate-180" aria-hidden="true" />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
      )}
    </Button>
  );
}

function StatusBadge({ status }: { status: TermStatus }) {
  return (
    <Badge
      variant={
        status === "approved" ? "secondary" : status === "pending" ? "outline" : "destructive"
      }
    >
      {status}
    </Badge>
  );
}

function CategoryBadge({ category }: { category: TermCategory | string }) {
  return (
    <Badge variant="outline" className="font-medium capitalize">
      {category}
    </Badge>
  );
}

function createGlossaryColumns(actions: GlossaryTableActions) {
  return columnHelper.columns([
    columnHelper.accessor("source", {
      id: "source",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column} label="Source" />,
      cell: ({ row }) => (
        <div
          className="min-w-[180px] max-w-[280px] truncate font-medium text-foreground"
          title={row.original.source}
        >
          {row.original.source}
        </div>
      ),
    }),
    columnHelper.accessor("target", {
      id: "target",
      enableHiding: false,
      header: ({ column }) => <SortableHeader column={column} label="Target" />,
      cell: ({ row }) => (
        <div
          className="min-w-[180px] max-w-[280px] truncate text-foreground"
          title={row.original.target}
        >
          {row.original.target}
        </div>
      ),
    }),
    columnHelper.accessor("category", {
      id: "category",
      header: ({ column }) => <SortableHeader column={column} label="Category" />,
      cell: ({ row }) => <CategoryBadge category={row.original.category} />,
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => <SortableHeader column={column} label="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    }),
    columnHelper.accessor("note", {
      id: "note",
      header: "Note",
      cell: ({ row }) => (
        <div
          className="max-w-[280px] truncate text-caption text-muted-foreground"
          title={row.original.note ?? undefined}
        >
          {row.original.note || "—"}
        </div>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      enableHiding: false,
      cell: ({ row }) => {
        const term = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${term.source}`}
                  disabled={actions.pending}
                />
              }
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Term actions</DropdownMenuLabel>
                <DropdownMenuItem disabled={actions.pending} onClick={() => actions.onEdit(term)}>
                  Edit
                </DropdownMenuItem>
                {term.status === "pending" && (
                  <>
                    <DropdownMenuItem
                      disabled={actions.pending}
                      onClick={() => actions.onApprove(term.id)}
                    >
                      Approve
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={actions.pending}
                      onClick={() => actions.onReject(term.id)}
                    >
                      Reject
                    </DropdownMenuItem>
                  </>
                )}
                {term.status === "rejected" && (
                  <DropdownMenuItem
                    disabled={actions.pending}
                    onClick={() => actions.onApprove(term.id)}
                  >
                    Restore
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={actions.pending}
                  onClick={() => actions.onDelete(term.id)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    }),
  ]);
}
const CLEAR_GLOSSARY_FILTERS: Partial<GlossaryListSearch> = {
  q: "",
  category: "all",
  status: "approved",
  sort: "source",
  dir: "asc",
  page: 1,
};

function GlossaryUpdateError({
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
      title="Unable to update glossary terms"
      error={error}
      onRetry={onRetry}
      className="m-3 min-h-0 sm:m-4"
    />
  );
}

interface GlossaryTableBodyProps {
  initialLoading: boolean;
  noRows: boolean;
  filtered: boolean;
  visibleColumnCount: number;
  rows: ReactNode;
  onClearFilters: () => void;
}

function GlossaryTableBody({
  initialLoading,
  noRows,
  filtered,
  visibleColumnCount,
  rows,
  onClearFilters,
}: GlossaryTableBodyProps) {
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
      emptyTitle="No glossary terms yet"
      filteredTitle="No terms match these filters"
      emptyDescription="Add a term or bulk import TSV mappings to keep translations consistent."
      filteredDescription="Try a different search or clear the filters to see all terms."
      onClearFilters={onClearFilters}
    />
  );
}

export function GlossaryTable({
  query,
  search,
  onRetry,
  onSearchChange,
  actions,
}: GlossaryTableProps) {
  const { page, isPending, isFetching, isPlaceholderData, isError, error } = query;
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({ note: false });

  useEffect(() => {
    if (!page || isFetching || isPlaceholderData || page.page === search.page) return;
    onSearchChange({ page: page.page }, true);
  }, [isFetching, isPlaceholderData, onSearchChange, page, search.page]);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: Math.max(0, search.page - 1), pageSize: search.pageSize }),
    [search.page, search.pageSize],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: search.sort, desc: search.dir === "desc" }],
    [search.dir, search.sort],
  );
  const columns = useMemo(() => createGlossaryColumns(actions), [actions]);
  const data = page?.rows ?? EMPTY_GLOSSARY_ROWS;

  const table = useTable({
    features: glossaryTableFeatures,
    columns,
    data,
    manualPagination: true,
    manualSorting: true,
    rowCount: page?.rowCount ?? 0,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination);
      if (next.pageSize !== search.pageSize) {
        onSearchChange(
          { pageSize: next.pageSize as GlossaryListSearch["pageSize"], page: 1 },
          true,
        );
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

  const rowCount = page?.rowCount ?? 0;
  const currentPage = page?.page ?? search.page;
  const filtered = hasActiveFilters(search);
  const noRows = Boolean(page && !isFetching && data.length === 0);
  const paginationBusy = isPlaceholderData || (isPending && !page);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
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

  if (isError && !page) {
    return (
      <QueryErrorState
        title="Unable to load glossary terms"
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Glossary terms"
      aria-busy={isFetching}
    >
      <GlossaryTableToolbar
        search={search}
        query={query}
        table={table}
        onSearchChange={onSearchChange}
      />

      <GlossaryUpdateError visible={isError && Boolean(page)} error={error} onRetry={onRetry} />

      <div className="overflow-x-auto">
        <Table className="min-w-[860px] text-caption">
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
          <GlossaryTableBody
            initialLoading={isPending && !page}
            noRows={noRows}
            filtered={filtered}
            visibleColumnCount={visibleColumnCount}
            rows={renderedRows}
            onClearFilters={() => onSearchChange(CLEAR_GLOSSARY_FILTERS, true)}
          />
        </Table>
      </div>

      <GlossaryTablePagination
        search={search}
        table={table}
        rowCount={rowCount}
        currentPage={currentPage}
        paginationBusy={paginationBusy}
        onSearchChange={onSearchChange}
      />
    </section>
  );
}
type GlossaryColumnTable = {
  getAllLeafColumns: () => Array<{
    id: string;
    getCanHide: () => boolean;
    getIsVisible: () => boolean;
    toggleVisibility: (visible: boolean) => void;
  }>;
};

type GlossaryPaginationTable = GlossaryColumnTable & {
  getRowModel: () => { rows: Array<unknown> };
  getPageCount: () => number;
  getCanPreviousPage: () => boolean;
  getCanNextPage: () => boolean;
  getCanLastPage: () => boolean;
  firstPage: () => void;
  previousPage: () => void;
  nextPage: () => void;
  lastPage: () => void;
};

function GlossaryTableToolbar({
  search,
  query,
  table,
  onSearchChange,
}: {
  search: GlossaryListSearch;
  query: GlossaryTableQueryState;
  table: GlossaryColumnTable;
  onSearchChange: GlossarySearchChange;
}) {
  const [queryInput, setQueryInput] = useState(search.q);

  useEffect(() => setQueryInput(search.q), [search.q]);
  useEffect(() => {
    if (queryInput === search.q) return;
    const timeoutId = window.setTimeout(
      () => onSearchChange({ q: queryInput, page: 1 }, true),
      300,
    );
    return () => window.clearTimeout(timeoutId);
  }, [onSearchChange, queryInput, search.q]);

  const isChangingQuery = query.isFetching && query.isPlaceholderData;
  return (
    <div className="border-b border-border p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,1fr)_20rem_auto] lg:items-center">
        <div className="relative min-w-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search source, target, or note"
            aria-label="Search glossary"
            className="h-10 pl-9"
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <Select
            value={search.category}
            items={categoryItems}
            onValueChange={(value) => {
              if (value && value !== search.category) {
                onSearchChange(
                  { category: value as GlossaryListSearch["category"], page: 1 },
                  true,
                );
              }
            }}
          >
            <SelectTrigger aria-label="Filter by category" className="h-10 min-w-0 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="character">Character</SelectItem>
              <SelectItem value="place">Place</SelectItem>
              <SelectItem value="skill">Skill</SelectItem>
              <SelectItem value="item">Item</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.status}
            items={statusItems}
            onValueChange={(value) => {
              if (value && value !== search.status) {
                onSearchChange({ status: value as GlossaryListSearch["status"], page: 1 }, true);
              }
            }}
          >
            <SelectTrigger aria-label="Filter by status" className="h-10 min-w-0 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {hasActiveFilters(search) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={() =>
                onSearchChange(
                  {
                    q: "",
                    category: "all",
                    status: "approved",
                    sort: "source",
                    dir: "asc",
                    page: 1,
                  },
                  true,
                )
              }
            >
              Clear filters
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" className="h-10">
                  <Columns3 className="size-4" aria-hidden="true" />
                  Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {table.getAllLeafColumns().map((column) =>
                  column.getCanHide() ? (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                    >
                      {columnLabels[column.id] ?? column.id}
                    </DropdownMenuCheckboxItem>
                  ) : null,
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-3 flex min-h-5 items-center justify-between gap-3 text-caption text-muted-foreground">
        <p>Approved glossary mappings used in future translations</p>
        {query.isFetching && !isChangingQuery && (
          <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Updating…
          </span>
        )}
      </div>
      {isChangingQuery && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-caption text-primary"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading glossary page…
        </div>
      )}
    </div>
  );
}

function GlossaryTablePagination({
  search,
  table,
  rowCount,
  currentPage,
  paginationBusy,
  onSearchChange,
}: {
  search: GlossaryListSearch;
  table: GlossaryPaginationTable;
  rowCount: number;
  currentPage: number;
  paginationBusy: boolean;
  onSearchChange: GlossarySearchChange;
}) {
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow =
    rowCount === 0 ? 0 : Math.min(rowCount, firstRow + table.getRowModel().rows.length - 1);
  return (
    <DataTablePagination
      table={table}
      firstRow={firstRow}
      lastRow={lastRow}
      rowCount={rowCount}
      currentPage={currentPage}
      busy={paginationBusy}
      pageSize={search.pageSize}
      pageSizeOptions={pageSizeOptions}
      formatRange={formatRange}
      onPageSizeChange={(pageSize) =>
        onSearchChange({ pageSize: pageSize as GlossaryListSearch["pageSize"], page: 1 }, true)
      }
    />
  );
}
