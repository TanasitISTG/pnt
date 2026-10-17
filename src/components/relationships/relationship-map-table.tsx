import { Network, Users } from "lucide-react";
import { useCallback, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { useTranslations } from "use-intl";

import {
  familiarityLabels,
  genderLabels,
  speakerStatusLabels,
  type RelationshipsTranslator,
} from "@/components/relationships/relationship-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTableCells,
  DataTableDesktopRegion,
  DataTableHeaderGroups,
  DataTableMobileRegion,
  DataTablePagination,
  DataTableRowActions,
  DataTableSection,
  DataTableSortableHeader,
  DataTableToolbar,
  type DataTablePaginationTable,
  type DataTableToolbarFilter,
} from "@/components/ui/data-table-parts";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable, type DataTableFeatures } from "@/components/ui/use-data-table";
import type { RelationshipMapSearch } from "@/lib/relationships/query";
import type { RelationshipTablePage } from "./relationship-table-data";
import type { CharacterProfile, CharacterRelationship } from "@/lib/relationships/schemas";

const characterColumnHelper = createColumnHelper<DataTableFeatures, CharacterProfile>();
const relationshipColumnHelper = createColumnHelper<DataTableFeatures, CharacterRelationship>();

export type RelationshipSearchChange = (
  changes: Partial<RelationshipMapSearch>,
  replace?: boolean,
) => void;

export interface RelationshipTableActions {
  onEditCharacter: (character: CharacterProfile) => void;
  onEditRelationship: (relationship: CharacterRelationship) => void;
  onToggle: (entryType: "character" | "relationship", entryId: string, enabled: boolean) => void;
  onAuto: (entryType: "character" | "relationship", entryId: string) => void;
  onDelete: (entryType: "character" | "relationship", entryId: string, label: string) => void;
  pending: boolean;
}

interface CharacterProfilesTableProps {
  page: RelationshipTablePage<CharacterProfile>;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

interface DirectedRelationshipsTableProps {
  characters: CharacterProfile[];
  page: RelationshipTablePage<CharacterRelationship>;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

const pageSizeOptions = [10, 25, 50] as const;

/** The two filters both tables carry, in the reader's language. */
function filterItems(t: RelationshipsTranslator) {
  return {
    state: {
      all: t("stateAll"),
      active: t("stateActive"),
      inactive: t("stateInactive"),
    },
    management: {
      all: t("managementAll"),
      manual: t("managementManual"),
      auto: t("managementAuto"),
    },
  };
}

/**
 * Everything the character table's cells say about a row, resolved once per render.
 *
 * A column factory is not a component, so it cannot call a hook: the table resolves the
 * copy and hands it in. The gender words are shared with the form that offers them, so a
 * row and the select that edits it cannot name the same value differently.
 */
function characterCopy(t: RelationshipsTranslator) {
  return {
    headers: {
      name: t("columnName"),
      aliases: t("columnAliases"),
      role: t("columnRole"),
      notes: t("columnNotes"),
      management: t("columnManagement"),
      state: t("columnState"),
      actions: t("actionsColumn"),
    },
    gender: genderLabels(t),
    noTargetName: t("noTargetName"),
    aliasesList: (list: string) => t("aliasesList", { list }),
    actionsFor: (name: string) => t("actionsForCharacter", { name }),
  };
}

type CharacterCopy = ReturnType<typeof characterCopy>;

/** The same, for the directed-relationship table. */
function relationshipCopy(t: RelationshipsTranslator) {
  return {
    headers: {
      name: t("columnSpeaker"),
      relationship: t("columnRelationship"),
      status: t("columnStatus"),
      speech: t("columnSpeech"),
      register: t("columnRegister"),
      notes: t("columnNotes"),
      management: t("columnManagement"),
      state: t("columnState"),
      actions: t("actionsColumn"),
    },
    speakerStatus: speakerStatusLabels(t),
    familiarity: familiarityLabels(t),
    self: (value: string) => t("speechSelf", { value }),
    addressee: (value: string) => t("speechAddressee", { value }),
    particles: (value: string) => t("speechParticles", { value }),
    inactiveCharacterDisabled: t("stateInactiveCharacterDisabled"),
    disabled: t("stateDisabled"),
    actionsFor: (speaker: string, listener: string) =>
      t("actionsForRelationship", { speaker, listener }),
  };
}

type RelationshipCopy = ReturnType<typeof relationshipCopy>;

const sortableSearchColumns: Record<string, RelationshipMapSearch["sort"]> = {
  name: "name",
  state: "state",
  management: "management",
};

function filteredSearch(search: RelationshipMapSearch) {
  return search.q !== "" || search.state !== "all" || search.management !== "all";
}

function clearFilters(onSearchChange: RelationshipSearchChange) {
  onSearchChange(
    { q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
    true,
  );
}

function buildFilters(
  t: RelationshipsTranslator,
  search: RelationshipMapSearch,
  onSearchChange: RelationshipSearchChange,
): DataTableToolbarFilter[] {
  const items = filterItems(t);
  return [
    {
      ariaLabel: t("filterByState"),
      value: search.state,
      items: items.state,
      onChange: (value) =>
        onSearchChange({ state: value as RelationshipMapSearch["state"], page: 1 }, true),
    },
    {
      ariaLabel: t("filterByManagement"),
      value: search.management,
      items: items.management,
      onChange: (value) =>
        onSearchChange({ management: value as RelationshipMapSearch["management"], page: 1 }, true),
    },
  ];
}

function paginationTableFor(
  currentPage: number,
  pageCount: number,
  onSearchChange: RelationshipSearchChange,
): DataTablePaginationTable {
  const lastPage = Math.max(1, pageCount);
  const goTo = (page: number) => onSearchChange({ page }, false);
  return {
    firstPage: () => goTo(1),
    previousPage: () => goTo(Math.max(1, currentPage - 1)),
    nextPage: () => goTo(Math.min(lastPage, currentPage + 1)),
    lastPage: () => goTo(lastPage),
    getCanPreviousPage: () => currentPage > 1,
    getCanNextPage: () => currentPage < lastPage,
    getCanLastPage: () => currentPage < lastPage,
    getPageCount: () => lastPage,
  };
}

function ManagementBadge({ locked }: { locked: boolean }) {
  const t = useTranslations("relationships");
  return (
    <Badge variant={locked ? "default" : "outline"}>
      {locked ? t("managementManual") : t("managementAuto")}
    </Badge>
  );
}

function StateBadge({ active, inactiveLabel }: { active: boolean; inactiveLabel?: string }) {
  const t = useTranslations("relationships");
  return (
    <Badge variant={active ? "secondary" : "outline"}>
      {active ? t("stateActive") : (inactiveLabel ?? t("stateInactive"))}
    </Badge>
  );
}

function EntryActions({
  actionsLabel,
  entryType,
  enabled,
  locked,
  pending,
  onEdit,
  onToggle,
  onAuto,
  onDelete,
}: {
  /** The whole accessible name, which names the entry it acts on. */
  actionsLabel: string;
  entryType: "character" | "relationship";
  enabled: boolean;
  locked: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onAuto: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  return (
    <DataTableRowActions
      triggerLabel={actionsLabel}
      menuLabel={
        entryType === "character" ? t("characterActionsMenu") : t("relationshipActionsMenu")
      }
      pending={pending}
      triggerClassName="min-h-11 min-w-11"
      contentClassName="w-56"
      items={[
        { label: tCommon("edit"), onSelect: onEdit },
        { label: enabled ? t("actionDisable") : t("actionRestore"), onSelect: onToggle },
        ...(locked ? [{ label: t("actionAuto"), onSelect: onAuto }] : []),
        { label: tCommon("delete"), variant: "destructive" as const, onSelect: onDelete },
      ]}
    />
  );
}

function CharacterEmptyState({
  filtered,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <Users className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {filtered ? t("charactersEmptyFiltered") : t("charactersEmpty")}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          {tCommon("clearFilters")}
        </Button>
      ) : (
        <Button size="sm" className="mt-4" onClick={onAdd}>
          <Users className="size-4" aria-hidden="true" />
          {t("addCharacter")}
        </Button>
      )}
    </div>
  );
}

function RelationshipEmptyState({
  filtered,
  canAdd,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  canAdd: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <Network className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {filtered ? t("relationshipsEmptyFiltered") : t("relationshipsEmpty")}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          {tCommon("clearFilters")}
        </Button>
      ) : (
        <Button
          size="sm"
          className="mt-4"
          onClick={onAdd}
          disabled={!canAdd}
          title={canAdd ? undefined : t("needsCharacters")}
        >
          <Network className="size-4" aria-hidden="true" />
          {t("addRelationship")}
        </Button>
      )}
    </div>
  );
}

function useCharacterProfileColumns(copy: CharacterCopy, actions: RelationshipTableActions) {
  return useMemo(
    () =>
      characterColumnHelper.columns([
        characterColumnHelper.accessor((character) => character.sourceName, {
          id: "name",
          header: ({ column }) => (
            <DataTableSortableHeader column={column} label={copy.headers.name} />
          ),
          cell: ({ row }) => (
            <div className="min-w-[180px] max-w-[260px]" title={row.original.sourceName}>
              <p className="truncate font-medium text-foreground">{row.original.sourceName}</p>
              {row.original.targetName && (
                <p className="truncate text-caption text-muted-foreground">
                  {row.original.targetName}
                </p>
              )}
            </div>
          ),
        }),
        characterColumnHelper.accessor("aliases", {
          id: "aliases",
          header: copy.headers.aliases,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="min-w-[150px] max-w-[220px] text-caption">
              <p className="truncate" title={row.original.aliases.join(", ")}>
                {row.original.aliases.length ? row.original.aliases.join(", ") : "—"}
              </p>
              <p className="mt-1 text-muted-foreground">{copy.gender[row.original.gender]}</p>
            </div>
          ),
        }),
        characterColumnHelper.accessor("role", {
          id: "role",
          header: copy.headers.role,
          enableSorting: false,
          cell: ({ row }) => (
            <div
              className="max-w-[180px] truncate text-caption"
              title={row.original.role ?? undefined}
            >
              {row.original.role || "—"}
            </div>
          ),
        }),
        characterColumnHelper.accessor((character) => character.notes || character.evidence || "", {
          id: "notes",
          header: copy.headers.notes,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[260px] text-caption text-muted-foreground">
              <p className="truncate" title={row.original.notes ?? undefined}>
                {row.original.notes || "—"}
              </p>
              {row.original.evidence && (
                <p className="mt-1 truncate italic" title={row.original.evidence}>
                  “{row.original.evidence}”
                </p>
              )}
            </div>
          ),
        }),
        characterColumnHelper.accessor((character) => (character.locked ? "manual" : "auto"), {
          id: "management",
          header: ({ column }) => (
            <DataTableSortableHeader column={column} label={copy.headers.management} />
          ),
          cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
        }),
        characterColumnHelper.accessor((character) => (character.enabled ? "active" : "inactive"), {
          id: "state",
          header: ({ column }) => (
            <DataTableSortableHeader column={column} label={copy.headers.state} />
          ),
          cell: ({ row }) => <StateBadge active={row.original.enabled} />,
        }),
        characterColumnHelper.display({
          id: "actions",
          header: "",
          enableHiding: false,
          cell: ({ row }) => {
            const character = row.original;
            return (
              <EntryActions
                actionsLabel={copy.actionsFor(character.sourceName)}
                entryType="character"
                enabled={character.enabled}
                locked={character.locked}
                pending={actions.pending}
                onEdit={() => actions.onEditCharacter(character)}
                onToggle={() => actions.onToggle("character", character.id, !character.enabled)}
                onAuto={() => actions.onAuto("character", character.id)}
                onDelete={() => actions.onDelete("character", character.id, character.sourceName)}
              />
            );
          },
        }),
      ]),
    [actions, copy],
  );
}

function CharacterMobileRows({
  rows,
  copy,
  actions,
}: {
  rows: CharacterProfile[];
  copy: CharacterCopy;
  actions: RelationshipTableActions;
}) {
  return (
    <>
      {rows.map((character) => (
        <article key={character.id} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-medium text-foreground">{character.sourceName}</p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">
                {character.targetName || copy.noTargetName}
              </p>
            </div>
            <EntryActions
              actionsLabel={copy.actionsFor(character.sourceName)}
              entryType="character"
              enabled={character.enabled}
              locked={character.locked}
              pending={actions.pending}
              onEdit={() => actions.onEditCharacter(character)}
              onToggle={() => actions.onToggle("character", character.id, !character.enabled)}
              onAuto={() => actions.onAuto("character", character.id)}
              onDelete={() => actions.onDelete("character", character.id, character.sourceName)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ManagementBadge locked={character.locked} />
            <StateBadge active={character.enabled} />
            <span className="text-caption text-muted-foreground">
              {copy.gender[character.gender]}
            </span>
          </div>
          {character.aliases.length > 0 ? (
            <p className="break-words text-caption text-muted-foreground">
              {copy.aliasesList(character.aliases.join(", "))}
            </p>
          ) : null}
          {character.role || character.notes ? (
            <p className="break-words text-caption text-muted-foreground">
              {[character.role, character.notes].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </article>
      ))}
    </>
  );
}

export function CharacterProfilesTable({
  page,
  search,
  onSearchChange,
  actions,
  onAdd,
}: CharacterProfilesTableProps) {
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  const copy = useMemo(() => characterCopy(t), [t]);
  const { rows: pageRows, rowCount, pageCount, currentPage } = page;
  const columns = useCharacterProfileColumns(copy, actions);
  const clear = () => clearFilters(onSearchChange);

  const { table } = useDataTable({
    columns,
    data: pageRows,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    initialColumnVisibility: { notes: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) => onSearchChange({ sort, dir, page: 1 }, true),
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filtered = filteredSearch(search);
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : Math.min(rowCount, firstRow + search.pageSize - 1);

  return (
    <DataTableSection ariaLabel={t("charactersTableAria")} busy={actions.pending}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel={t("searchCharacters")}
        searchPlaceholder={t("searchCharacters")}
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={buildFilters(t, search, onSearchChange)}
        columns={{ table, labels: copy.headers, menuClassName: "w-52" }}
        clearLabel={tCommon("clearFilters")}
        filtered={filtered}
        onClearFilters={clear}
        description={t("charactersTableDescription")}
      />
      {rowCount === 0 ? (
        <div className="p-4 md:hidden" aria-label={t("charactersMobileAria")} role="region">
          <CharacterEmptyState filtered={filtered} onClear={clear} onAdd={onAdd} />
        </div>
      ) : (
        <DataTableMobileRegion ariaLabel={t("charactersMobileAria")}>
          <CharacterMobileRows rows={pageRows} copy={copy} actions={actions} />
        </DataTableMobileRegion>
      )}

      <DataTableDesktopRegion ariaLabel={t("charactersDesktopAria")}>
        <Table className="min-w-[1000px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <TableBody>
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <CharacterEmptyState filtered={filtered} onClear={clear} onAdd={onAdd} />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  <DataTableCells
                    cells={row.getVisibleCells()}
                    renderCell={(cell) => <table.FlexRender cell={cell} />}
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableDesktopRegion>
      <DataTablePagination
        table={paginationTableFor(currentPage, pageCount, onSearchChange)}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={actions.pending}
        pageSize={search.pageSize}
        pageSizeOptions={pageSizeOptions}
        noun={t("nounCharacters")}
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}

function useDirectedRelationshipColumns(
  copy: RelationshipCopy,
  actions: RelationshipTableActions,
  characterLabel: (id: string) => string,
  isActive: (relationship: CharacterRelationship) => boolean,
) {
  return useMemo(
    () =>
      relationshipColumnHelper.columns([
        relationshipColumnHelper.accessor(
          (relationship) =>
            `${characterLabel(relationship.speakerId)} ${characterLabel(relationship.listenerId)}`,
          {
            id: "name",
            header: ({ column }) => (
              <DataTableSortableHeader column={column} label={copy.headers.name} />
            ),
            cell: ({ row }) => (
              <div className="min-w-[210px] max-w-[280px]">
                <p className="truncate font-medium text-foreground">
                  {characterLabel(row.original.speakerId)}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  → {characterLabel(row.original.listenerId)}
                </p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor("relationship", {
          id: "relationship",
          header: copy.headers.relationship,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[180px] truncate" title={row.original.relationship}>
              {row.original.relationship}
            </div>
          ),
        }),
        relationshipColumnHelper.accessor(
          (relationship) => `${relationship.speakerStatus} ${relationship.familiarity}`,
          {
            id: "status",
            header: copy.headers.status,
            enableSorting: false,
            cell: ({ row }) => (
              <div className="min-w-[130px] text-caption">
                <p>{copy.speakerStatus[row.original.speakerStatus]}</p>
                <p className="mt-1 text-muted-foreground">
                  {copy.familiarity[row.original.familiarity]}
                </p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) =>
            `${relationship.selfPronoun} ${relationship.addresseeTerm} ${relationship.sentenceParticles}`,
          {
            id: "speech",
            header: copy.headers.speech,
            enableSorting: false,
            cell: ({ row }) => (
              <div className="min-w-[190px] max-w-[260px] text-caption text-muted-foreground">
                <p className="truncate" title={row.original.selfPronoun ?? undefined}>
                  {copy.self(row.original.selfPronoun || "—")}
                </p>
                <p className="truncate" title={row.original.addresseeTerm ?? undefined}>
                  {copy.addressee(row.original.addresseeTerm || "—")}
                </p>
                <p className="truncate" title={row.original.sentenceParticles ?? undefined}>
                  {copy.particles(row.original.sentenceParticles || "—")}
                </p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor("register", {
          id: "register",
          header: copy.headers.register,
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[140px] truncate" title={row.original.register ?? undefined}>
              {row.original.register || "—"}
            </div>
          ),
        }),
        relationshipColumnHelper.accessor(
          (relationship) => relationship.notes || relationship.evidence || "",
          {
            id: "notes",
            header: copy.headers.notes,
            enableSorting: false,
            cell: ({ row }) => (
              <div className="max-w-[260px] text-caption text-muted-foreground">
                <p className="truncate" title={row.original.notes ?? undefined}>
                  {row.original.notes || "—"}
                </p>
                {row.original.evidence && (
                  <p className="mt-1 truncate italic" title={row.original.evidence}>
                    “{row.original.evidence}”
                  </p>
                )}
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) => (relationship.locked ? "manual" : "auto"),
          {
            id: "management",
            header: ({ column }) => (
              <DataTableSortableHeader column={column} label={copy.headers.management} />
            ),
            cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) => (isActive(relationship) ? "active" : "inactive"),
          {
            id: "state",
            header: ({ column }) => (
              <DataTableSortableHeader column={column} label={copy.headers.state} />
            ),
            cell: ({ row }) => (
              <StateBadge
                active={isActive(row.original)}
                inactiveLabel={
                  row.original.enabled ? copy.inactiveCharacterDisabled : copy.disabled
                }
              />
            ),
          },
        ),
        relationshipColumnHelper.display({
          id: "actions",
          header: "",
          enableHiding: false,
          cell: ({ row }) => {
            const relationship = row.original;
            const speakerName = characterLabel(relationship.speakerId);
            const listenerName = characterLabel(relationship.listenerId);
            // The entry's own name, as data: two character names around a direction. The
            // words "to" and "Actions for" are the catalog's, in the sentence below.
            const entryName = `${speakerName} → ${listenerName}`;
            return (
              <EntryActions
                actionsLabel={copy.actionsFor(speakerName, listenerName)}
                entryType="relationship"
                enabled={relationship.enabled}
                locked={relationship.locked}
                pending={actions.pending}
                onEdit={() => actions.onEditRelationship(relationship)}
                onToggle={() =>
                  actions.onToggle("relationship", relationship.id, !relationship.enabled)
                }
                onAuto={() => actions.onAuto("relationship", relationship.id)}
                onDelete={() => actions.onDelete("relationship", relationship.id, entryName)}
              />
            );
          },
        }),
      ]),
    [actions, characterLabel, copy, isActive],
  );
}

function RelationshipMobileRows({
  rows,
  copy,
  characterLabel,
  isActive,
  actions,
}: {
  rows: CharacterRelationship[];
  copy: RelationshipCopy;
  characterLabel: (id: string) => string;
  isActive: (relationship: CharacterRelationship) => boolean;
  actions: RelationshipTableActions;
}) {
  return (
    <>
      {rows.map((relationship) => {
        const speakerName = characterLabel(relationship.speakerId);
        const listenerName = characterLabel(relationship.listenerId);
        const entryName = `${speakerName} → ${listenerName}`;
        return (
          <article key={relationship.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-foreground">
                  {characterLabel(relationship.speakerId)}
                </p>
                <p className="mt-0.5 break-words text-sm text-muted-foreground">
                  → {characterLabel(relationship.listenerId)}
                </p>
              </div>
              <EntryActions
                actionsLabel={copy.actionsFor(speakerName, listenerName)}
                entryType="relationship"
                enabled={relationship.enabled}
                locked={relationship.locked}
                pending={actions.pending}
                onEdit={() => actions.onEditRelationship(relationship)}
                onToggle={() =>
                  actions.onToggle("relationship", relationship.id, !relationship.enabled)
                }
                onAuto={() => actions.onAuto("relationship", relationship.id)}
                onDelete={() => actions.onDelete("relationship", relationship.id, entryName)}
              />
            </div>
            <p className="break-words text-foreground">{relationship.relationship}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge
                active={isActive(relationship)}
                inactiveLabel={
                  relationship.enabled ? copy.inactiveCharacterDisabled : copy.disabled
                }
              />
              <ManagementBadge locked={relationship.locked} />
              <span className="text-caption text-muted-foreground">
                {copy.familiarity[relationship.familiarity]} ·{" "}
                {copy.speakerStatus[relationship.speakerStatus]}
              </span>
            </div>
            {relationship.register ||
            relationship.selfPronoun ||
            relationship.addresseeTerm ||
            relationship.sentenceParticles ? (
              <p className="break-words text-caption text-muted-foreground">
                {[
                  relationship.register,
                  relationship.selfPronoun,
                  relationship.addresseeTerm,
                  relationship.sentenceParticles,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {relationship.notes ? (
              <p className="break-words text-caption text-muted-foreground">{relationship.notes}</p>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

export function DirectedRelationshipsTable({
  characters,
  page,
  search,
  onSearchChange,
  actions,
  onAdd,
}: DirectedRelationshipsTableProps) {
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const t = useTranslations("relationships");
  const tCommon = useTranslations("common");
  const copy = useMemo(() => relationshipCopy(t), [t]);
  const characterLabel = useCallback(
    (id: string) => charactersById.get(id)?.sourceName ?? t("unknownCharacter"),
    [charactersById, t],
  );
  const isActive = useCallback(
    (relationship: CharacterRelationship) =>
      relationship.enabled &&
      Boolean(charactersById.get(relationship.speakerId)?.enabled) &&
      Boolean(charactersById.get(relationship.listenerId)?.enabled),
    [charactersById],
  );
  const { rows: pageRows, rowCount, pageCount, currentPage } = page;
  const columns = useDirectedRelationshipColumns(copy, actions, characterLabel, isActive);
  const clear = () => clearFilters(onSearchChange);

  const { table } = useDataTable({
    columns,
    data: pageRows,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    initialColumnVisibility: { notes: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) => onSearchChange({ sort, dir, page: 1 }, true),
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filtered = filteredSearch(search);
  const canAdd = characters.length >= 2;
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : Math.min(rowCount, firstRow + search.pageSize - 1);

  return (
    <DataTableSection ariaLabel={t("relationshipsTableAria")} busy={actions.pending}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel={t("searchRelationships")}
        searchPlaceholder={t("searchRelationships")}
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={buildFilters(t, search, onSearchChange)}
        columns={{ table, labels: copy.headers, menuClassName: "w-52" }}
        clearLabel={tCommon("clearFilters")}
        filtered={filtered}
        onClearFilters={clear}
        description={t("relationshipsTableDescription")}
      />
      {rowCount === 0 ? (
        <div className="p-4 md:hidden" aria-label={t("relationshipsMobileAria")} role="region">
          <RelationshipEmptyState
            filtered={filtered}
            canAdd={canAdd}
            onClear={clear}
            onAdd={onAdd}
          />
        </div>
      ) : (
        <DataTableMobileRegion ariaLabel={t("relationshipsMobileAria")}>
          <RelationshipMobileRows
            rows={pageRows}
            copy={copy}
            characterLabel={characterLabel}
            isActive={isActive}
            actions={actions}
          />
        </DataTableMobileRegion>
      )}

      <DataTableDesktopRegion ariaLabel={t("relationshipsDesktopAria")}>
        <Table className="min-w-[1250px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <TableBody>
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <RelationshipEmptyState
                    filtered={filtered}
                    canAdd={canAdd}
                    onClear={clear}
                    onAdd={onAdd}
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  <DataTableCells
                    cells={row.getVisibleCells()}
                    renderCell={(cell) => <table.FlexRender cell={cell} />}
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableDesktopRegion>
      <DataTablePagination
        table={paginationTableFor(currentPage, pageCount, onSearchChange)}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={actions.pending}
        pageSize={search.pageSize}
        pageSizeOptions={pageSizeOptions}
        noun={t("nounRelationships")}
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
