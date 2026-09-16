import { useEffect, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

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
  DataTableRowActions,
  DataTableSection,
  DataTableSortableHeader,
  DataTableToolbar,
} from "@/components/ui/data-table-parts";
import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable, type DataTableFeatures } from "@/components/ui/use-data-table";
import type {
  GlossaryListPage,
  GlossaryListRow,
  GlossaryListSearch,
  TermCategory,
  TermStatus,
} from "@/lib/glossary/schemas";

const columnHelper = createColumnHelper<DataTableFeatures, GlossaryListRow>();
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

function hasActiveFilters(search: GlossaryListSearch) {
  return search.q !== "" || search.category !== "all" || search.status !== "approved";
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
      header: ({ column }) => <DataTableSortableHeader column={column} label="Source" />,
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
      header: ({ column }) => <DataTableSortableHeader column={column} label="Target" />,
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
      header: ({ column }) => <DataTableSortableHeader column={column} label="Category" />,
      cell: ({ row }) => <CategoryBadge category={row.original.category} />,
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => <DataTableSortableHeader column={column} label="Status" />,
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
          <DataTableRowActions
            triggerLabel={`Actions for ${term.source}`}
            menuLabel="Term actions"
            pending={actions.pending}
            items={[
              { label: "Edit", onSelect: () => actions.onEdit(term) },
              ...(term.status === "pending"
                ? [
                    { label: "Approve", onSelect: () => actions.onApprove(term.id) },
                    { label: "Reject", onSelect: () => actions.onReject(term.id) },
                  ]
                : []),
              ...(term.status === "rejected"
                ? [{ label: "Restore", onSelect: () => actions.onApprove(term.id) }]
                : []),
              {
                label: "Delete",
                variant: "destructive" as const,
                onSelect: () => actions.onDelete(term.id),
              },
            ]}
          />
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

function GlossaryMobileRows({
  rows,
  actions,
}: {
  rows: GlossaryListRow[];
  actions: GlossaryTableActions;
}) {
  return (
    <>
      {rows.map((term) => (
        <article key={term.id} className="space-y-3 p-4">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">Source</p>
              <p className="break-words font-medium text-foreground">{term.source}</p>
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">Target</p>
              <p className="break-words text-foreground">{term.target}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={term.category} />
            <StatusBadge status={term.status} />
          </div>
          {term.note ? (
            <p className="break-words text-caption text-muted-foreground">{term.note}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-11"
              variant="outline"
              disabled={actions.pending}
              onClick={() => actions.onEdit(term)}
            >
              Edit
            </Button>
            {term.status === "pending" ? (
              <>
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={actions.pending}
                  onClick={() => actions.onApprove(term.id)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  className="min-h-11"
                  variant="outline"
                  disabled={actions.pending}
                  onClick={() => actions.onReject(term.id)}
                >
                  Reject
                </Button>
              </>
            ) : term.status === "rejected" ? (
              <Button
                size="sm"
                className="min-h-11"
                disabled={actions.pending}
                onClick={() => actions.onApprove(term.id)}
              >
                Restore
              </Button>
            ) : null}
            <Button
              size="sm"
              className="min-h-11"
              variant="destructive"
              disabled={actions.pending}
              onClick={() => actions.onDelete(term.id)}
            >
              Delete
            </Button>
          </div>
        </article>
      ))}
    </>
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

  useEffect(() => {
    if (!page || isFetching || isPlaceholderData || page.page === search.page) return;
    onSearchChange({ page: page.page }, true);
  }, [isFetching, isPlaceholderData, onSearchChange, page, search.page]);

  const columns = useMemo(() => createGlossaryColumns(actions), [actions]);
  const data = page?.rows ?? EMPTY_GLOSSARY_ROWS;
  const rowCount = page?.rowCount ?? 0;
  const currentPage = page?.page ?? search.page;
  const clearFilters = () => onSearchChange(CLEAR_GLOSSARY_FILTERS, true);

  const { table } = useDataTable({
    columns,
    data,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    initialColumnVisibility: { note: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as GlossaryListSearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) =>
      onSearchChange({ sort: sort as GlossaryListSearch["sort"], dir, page: 1 }, true),
  });

  const filtered = hasActiveFilters(search);
  const noRows = Boolean(page && !isFetching && data.length === 0);
  const paginationBusy = isPlaceholderData || (isPending && !page);
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow =
    rowCount === 0 ? 0 : Math.min(rowCount, firstRow + table.getRowModel().rows.length - 1);
  const renderedRows = table.getRowModel().rows.map((row) => (
    <TableRow key={row.id} className="h-[4.25rem]">
      <DataTableCells
        cells={row.getVisibleCells()}
        renderCell={(cell) => <table.FlexRender cell={cell} />}
      />
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
    <DataTableSection ariaLabel="Glossary terms" busy={isFetching}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel="Search glossary"
        searchPlaceholder="Search source, target, or note"
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={[
          {
            ariaLabel: "Filter by category",
            value: search.category,
            items: categoryItems,
            onChange: (value) =>
              onSearchChange({ category: value as GlossaryListSearch["category"], page: 1 }, true),
          },
          {
            ariaLabel: "Filter by status",
            value: search.status,
            items: statusItems,
            onChange: (value) =>
              onSearchChange({ status: value as GlossaryListSearch["status"], page: 1 }, true),
          },
        ]}
        columns={{ table, labels: columnLabels }}
        clearLabel="Clear filters"
        filtered={filtered}
        onClearFilters={clearFilters}
        description="Approved glossary mappings used in future translations"
        query={{ isFetching, isPlaceholderData }}
        busyMessage="Loading glossary page…"
      />

      <GlossaryUpdateError visible={isError && Boolean(page)} error={error} onRetry={onRetry} />

      <DataTableMobileRegion ariaLabel={noRows || isPending ? undefined : "Mobile glossary terms"}>
        {isPending && !page ? (
          <DataTableMobileLoading message="Loading glossary terms…" />
        ) : noRows ? (
          <DataTableMobileEmpty
            filtered={filtered}
            emptyTitle="No glossary terms yet"
            filteredTitle="No terms match these filters"
            emptyDescription="Add a term to get started."
            filteredDescription="Try a different search or clear the filters."
            onClearFilters={clearFilters}
          />
        ) : (
          <GlossaryMobileRows rows={data} actions={actions} />
        )}
      </DataTableMobileRegion>

      <DataTableDesktopRegion ariaLabel="Desktop glossary terms">
        <Table className="min-w-[860px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <DataTableBody
            initialLoading={isPending && !page}
            noRows={noRows}
            filtered={filtered}
            visibleColumnCount={visibleColumnCount}
            rows={renderedRows}
            emptyTitle="No glossary terms yet"
            filteredTitle="No terms match these filters"
            emptyDescription="Add a term or bulk import TSV mappings to keep translations consistent."
            filteredDescription="Try a different search or clear the filters to see all terms."
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
        noun="terms"
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as GlossaryListSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
