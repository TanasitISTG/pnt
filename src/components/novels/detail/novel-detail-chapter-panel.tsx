import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Search, X } from "lucide-react";

import { QueryErrorState } from "@/components/query-error-state";
import type { ChapterTableProps } from "@/components/chapters/table/chapter-table";
import { ChaptersTableSection } from "@/components/chapters/table/chapters-table-section";
import { ChaptersToolbar } from "@/components/chapters/toolbar/chapters-toolbar";
import type { ChapterRow } from "@/components/chapters/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterChapters } from "@/lib/content/chapter/chapter-search";
export interface NovelDetailChapterPanelDetail {
  chapters: ChapterRow[];
  chapterUiLoading: boolean;
  isChaptersPending: boolean;
  lastReadChapter: ChapterRow | null;
  selectedIds: Set<string>;
  selectedMissingIds: string[];
  selectedTranslatedIds: string[];
  selectedActiveIds: string[];
  selectableIds: string[];
  batchStarting: boolean;
  activeJobsError: unknown;
  refetchActiveJobs: () => Promise<unknown>;
  batchStopping: boolean;
  handleBatchTranslate: () => void;
  onRequestBatchRetranslate: () => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setStopSelectedOpen: (open: boolean) => void;
  selectByRange: (from: number, to: number) => void;
  readyUnpublishedCount: number;
  unreadyCount: number;
  publishAllChapters: () => void;
  publishingAll: boolean;
  missingTitleCount: number;
  backfillTitles: () => void;
  backfillingTitles: boolean;
  setReorderOpen: (open: boolean) => void;
  reorderDisabled: boolean;
  deletingAllTranslations: boolean;
  setDeleteAllTranslationsOpen: (open: boolean) => void;
}

interface ChapterSearchToolbarProps {
  query: string;
  totalCount: number;
  resultCount: number;
  disabled: boolean;
  onChange: (query: string) => void;
}

function ChapterSearchToolbar({
  query,
  totalCount,
  resultCount,
  disabled,
  onChange,
}: ChapterSearchToolbarProps) {
  const [queryInput, setQueryInput] = useState(query);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  useEffect(() => {
    if (disabled || queryInput === query) return;
    const timeoutId = window.setTimeout(() => onChangeRef.current(queryInput), 300);
    return () => window.clearTimeout(timeoutId);
  }, [disabled, query, queryInput]);

  const handleClear = () => {
    setQueryInput("");
    onChangeRef.current("");
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Search chapter number or title"
          aria-label="Search chapters"
          disabled={disabled}
          className="h-10 pl-9"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
        <span>
          {resultCount} of {totalCount} chapters
        </span>
        {queryInput ? (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={handleClear}>
            <X className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface NovelDetailChapterPanelProps {
  isAdmin: boolean;
  chapterQuery: string;
  detail: NovelDetailChapterPanelDetail;
  tableProps: Omit<ChapterTableProps, "chapters">;
  onReviewSearchChange: (query: string) => void;
  onAddChapters?: () => void;
}

export function NovelDetailChapterPanel({
  isAdmin,
  chapterQuery,
  detail,
  tableProps,
  onReviewSearchChange,
  onAddChapters,
}: NovelDetailChapterPanelProps) {
  const {
    chapters,
    chapterUiLoading,
    isChaptersPending,
    lastReadChapter,
    selectedIds,
    selectedMissingIds,
    selectedTranslatedIds,
    selectedActiveIds,
    selectableIds,
    batchStarting,
    batchStopping,
    handleBatchTranslate,
    onRequestBatchRetranslate,
    activeJobsError,
    refetchActiveJobs,
    setSelectedIds,
    setStopSelectedOpen,
    selectByRange,
    readyUnpublishedCount,
    unreadyCount,
    publishAllChapters,
    publishingAll,
    missingTitleCount,
    backfillTitles,
    backfillingTitles,
    setReorderOpen,
    reorderDisabled,
    deletingAllTranslations,
    setDeleteAllTranslationsOpen,
  } = detail;
  const filteredChapters = useMemo(
    () => filterChapters(chapters, chapterQuery),
    [chapterQuery, chapters],
  );
  const filteredIdSet = useMemo(
    () => new Set(filteredChapters.map((chapter) => chapter.id)),
    [filteredChapters],
  );
  const hiddenSelectedCount = useMemo(
    () => [...selectedIds].filter((chapterId) => !filteredIdSet.has(chapterId)).length,
    [filteredIdSet, selectedIds],
  );
  const chapterTableLoading = isChaptersPending || chapterUiLoading;
  const titleEditing = tableProps.titleEdit !== null;

  return (
    <div className="flex flex-col gap-4">
      {activeJobsError ? (
        <QueryErrorState
          title="Unable to refresh translation status"
          error={activeJobsError}
          onRetry={() => void refetchActiveJobs()}
          className="my-0 min-h-0"
        />
      ) : null}
      <ChapterSearchToolbar
        query={chapterQuery}
        totalCount={chapters.length}
        resultCount={filteredChapters.length}
        disabled={titleEditing}
        onChange={onReviewSearchChange}
      />
      {!chapterTableLoading && (
        <ChaptersToolbar
          isAdmin={isAdmin}
          selectedCount={selectedIds.size}
          hiddenSelectedCount={hiddenSelectedCount}
          selectableCount={selectableIds.length}
          selectedMissingCount={selectedMissingIds.length}
          selectedTranslatedCount={selectedTranslatedIds.length}
          selectedActiveCount={selectedActiveIds.length}
          batchStarting={batchStarting}
          batchStopping={batchStopping}
          onBatchTranslate={handleBatchTranslate}
          onRequestBatchRetranslate={onRequestBatchRetranslate}
          onRequestBatchStop={() => setStopSelectedOpen(true)}
          onClearSelection={() => setSelectedIds(new Set())}
          onSelectRange={selectByRange}
          readyUnpublishedCount={readyUnpublishedCount}
          unreadyCount={unreadyCount}
          onPublishAll={() => publishAllChapters()}
          publishingAll={publishingAll}
          missingTitleCount={missingTitleCount}
          onBackfillTitles={() => backfillTitles()}
          backfillingTitles={backfillingTitles}
          onReorderChapters={() => setReorderOpen(true)}
          reorderDisabled={reorderDisabled}
          chapterCount={chapters.length}
          deletingAllTranslations={deletingAllTranslations}
          onDeleteAllTranslations={() => setDeleteAllTranslationsOpen(true)}
        />
      )}
      {!chapterTableLoading && filteredChapters.length === 0 && chapters.length > 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No chapters match this search.</p>
        </div>
      ) : (
        <ChaptersTableSection
          chapters={filteredChapters}
          isAdmin={isAdmin}
          loading={chapterTableLoading}
          tableProps={tableProps}
          initialChapterId={lastReadChapter?.id}
          groupResetKey={chapterQuery}
          onAddChapters={onAddChapters}
        />
      )}
    </div>
  );
}
