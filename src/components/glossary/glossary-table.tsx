import { useEffect, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "use-intl";

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

/**
 * The words a column needs, resolved where the catalog is reachable. The column factory stays a
 * plain function so the table's shape is not written twice.
 */
interface GlossaryColumnLabels {
  source: string;
  target: string;
  category: string;
  status: string;
  note: string;
  termActions: (source: string) => string;
  menu: string;
  edit: string;
  approve: string;
  reject: string;
  restore: string;
  remove: string;
}

const pageSizeOptions = [10, 25, 50] as const;
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
  const t = useTranslations("studio");
  const label =
    status === "approved"
      ? t("termStatusApproved")
      : status === "pending"
        ? t("termStatusPending")
        : t("termStatusRejected");
  return (
    <Badge
      variant={
        status === "approved" ? "secondary" : status === "pending" ? "outline" : "destructive"
      }
    >
      {label}
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

function createGlossaryColumns(actions: GlossaryTableActions, labels: GlossaryColumnLabels) {
  return columnHelper.columns([
    columnHelper.accessor("source", {
      id: "source",
      enableHiding: false,
      header: ({ column }) => <DataTableSortableHeader column={column} label={labels.source} />,
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
      header: ({ column }) => <DataTableSortableHeader column={column} label={labels.target} />,
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
      header: ({ column }) => <DataTableSortableHeader column={column} label={labels.category} />,
      cell: ({ row }) => <CategoryBadge category={row.original.category} />,
    }),
    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => <DataTableSortableHeader column={column} label={labels.status} />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    }),
    columnHelper.accessor("note", {
      id: "note",
      header: labels.note,
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
            triggerLabel={labels.termActions(term.source)}
            menuLabel={labels.menu}
            pending={actions.pending}
            items={[
              { label: labels.edit, onSelect: () => actions.onEdit(term) },
              ...(term.status === "pending"
                ? [
                    { label: labels.approve, onSelect: () => actions.onApprove(term.id) },
                    { label: labels.reject, onSelect: () => actions.onReject(term.id) },
                  ]
                : []),
              ...(term.status === "rejected"
                ? [{ label: labels.restore, onSelect: () => actions.onApprove(term.id) }]
                : []),
              {
                label: labels.remove,
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
  const t = useTranslations("studio");
  if (!visible) return null;
  return (
    <QueryErrorState
      title={t("glossaryUpdateFailed")}
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
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  return (
    <>
      {rows.map((term) => (
        <article key={term.id} className="space-y-3 p-4">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{t("termColumnSource")}</p>
              <p className="break-words font-medium text-foreground">{term.source}</p>
            </div>
            <div className="min-w-0">
              <p className="text-caption text-muted-foreground">{t("termColumnTarget")}</p>
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
              {tCommon("edit")}
            </Button>
            {term.status === "pending" ? (
              <>
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={actions.pending}
                  onClick={() => actions.onApprove(term.id)}
                >
                  {t("termActionApprove")}
                </Button>
                <Button
                  size="sm"
                  className="min-h-11"
                  variant="outline"
                  disabled={actions.pending}
                  onClick={() => actions.onReject(term.id)}
                >
                  {t("termActionReject")}
                </Button>
              </>
            ) : term.status === "rejected" ? (
              <Button
                size="sm"
                className="min-h-11"
                disabled={actions.pending}
                onClick={() => actions.onApprove(term.id)}
              >
                {t("termActionRestore")}
              </Button>
            ) : null}
            <Button
              size="sm"
              className="min-h-11"
              variant="destructive"
              disabled={actions.pending}
              onClick={() => actions.onDelete(term.id)}
            >
              {tCommon("delete")}
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
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  const { page, isPending, isFetching, isPlaceholderData, isError, error } = query;

  useEffect(() => {
    if (!page || isFetching || isPlaceholderData || page.page === search.page) return;
    onSearchChange({ page: page.page }, true);
  }, [isFetching, isPlaceholderData, onSearchChange, page, search.page]);

  const categoryItems = {
    all: t("termAllCategories"),
    character: t("termCategoryCharacter"),
    place: t("termCategoryPlace"),
    skill: t("termCategorySkill"),
    item: t("termCategoryItem"),
    other: t("termCategoryOther"),
  };
  const statusItems = {
    all: t("termAllStatuses"),
    approved: t("termStatusApproved"),
    pending: t("termStatusPending"),
    rejected: t("termStatusRejected"),
  };
  const columns = useMemo(
    () =>
      createGlossaryColumns(actions, {
        source: t("termColumnSource"),
        target: t("termColumnTarget"),
        category: t("termColumnCategory"),
        status: t("termColumnStatus"),
        note: t("termColumnNote"),
        termActions: (source: string) => t("glossaryTermActions", { source }),
        menu: t("glossaryTermActionsMenu"),
        edit: tCommon("edit"),
        approve: t("termActionApprove"),
        reject: t("termActionReject"),
        restore: t("termActionRestore"),
        remove: tCommon("delete"),
      }),
    [actions, t, tCommon],
  );
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
        title={t("glossaryLoadFailed")}
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }

  return (
    <DataTableSection ariaLabel={t("glossaryTableLabel")} busy={isFetching}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel={t("glossarySearchLabel")}
        searchPlaceholder={t("glossarySearchPlaceholder")}
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={[
          {
            ariaLabel: t("glossaryFilterCategory"),
            value: search.category,
            items: categoryItems,
            onChange: (value) =>
              onSearchChange({ category: value as GlossaryListSearch["category"], page: 1 }, true),
          },
          {
            ariaLabel: t("glossaryFilterStatus"),
            value: search.status,
            items: statusItems,
            onChange: (value) =>
              onSearchChange({ status: value as GlossaryListSearch["status"], page: 1 }, true),
          },
        ]}
        columns={{
          table,
          labels: {
            source: t("termColumnSource"),
            target: t("termColumnTarget"),
            category: t("termColumnCategory"),
            status: t("termColumnStatus"),
            note: t("termColumnNote"),
            actions: t("termColumnActions"),
          },
        }}
        clearLabel={tCommon("clearFilters")}
        filtered={filtered}
        onClearFilters={clearFilters}
        description={t("glossaryTableDescription")}
        query={{ isFetching, isPlaceholderData }}
        busyMessage={t("glossaryLoading")}
      />

      <GlossaryUpdateError visible={isError && Boolean(page)} error={error} onRetry={onRetry} />

      <DataTableMobileRegion ariaLabel={noRows || isPending ? undefined : t("glossaryMobileLabel")}>
        {isPending && !page ? (
          <DataTableMobileLoading message={t("glossaryLoadingTerms")} />
        ) : noRows ? (
          <DataTableMobileEmpty
            filtered={filtered}
            emptyTitle={t("glossaryEmptyTitle")}
            filteredTitle={t("glossaryFilteredTitle")}
            emptyDescription={t("glossaryEmptyMobile")}
            filteredDescription={t("glossaryFilteredMobile")}
            onClearFilters={clearFilters}
          />
        ) : (
          <GlossaryMobileRows rows={data} actions={actions} />
        )}
      </DataTableMobileRegion>

      <DataTableDesktopRegion ariaLabel={t("glossaryDesktopLabel")}>
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
            emptyTitle={t("glossaryEmptyTitle")}
            filteredTitle={t("glossaryFilteredTitle")}
            emptyDescription={t("glossaryEmptyDesktop")}
            filteredDescription={t("glossaryFilteredDesktop")}
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
        noun={t("glossaryNounTerms")}
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as GlossaryListSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
