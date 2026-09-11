import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Search, X } from "lucide-react";

import type { ChapterTableProps } from "@/components/chapters/chapter-table";
import { ChaptersTableSection } from "@/components/chapters/chapters-table-section";
import { ChaptersToolbar } from "@/components/chapters/chapters-toolbar";
import type { ChapterRow } from "@/components/chapters/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterChapters } from "@/lib/content/chapter-search";
export interface NovelDetailChapterPanelDetail {
  chapters: ChapterRow[];
  chapterTableProps: Omit<ChapterTableProps, "chapters">;
  chapterUiLoading: boolean;
  isChaptersPending: boolean;
  lastReadChapter: ChapterRow | null;
  selectedIds: Set<string>;
  selectedTranslatableIds: string[];
  selectedActiveIds: string[];
  selectableIds: string[];
  batchStarting: boolean;
  batchStopping: boolean;
  handleBatchTranslate: () => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setStopSelectedOpen: (open: boolean) => void;
  batchRangeFrom: string;
  batchRangeTo: string;
  setBatchRangeFrom: (value: string) => void;
  setBatchRangeTo: (value: string) => void;
  selectByRange: () => void;
  unpublishedCount: number;
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
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled || queryInput === query) return;
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onChange(queryInput);
    }, 300);
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [disabled, onChange, query, queryInput]);

  const handleClear = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setQueryInput("");
    onChange("");
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
  onReviewSearchChange: (query: string) => void;
  onAddChapters?: () => void;
}

export function NovelDetailChapterPanel({
  isAdmin,
  chapterQuery,
  detail,
  onReviewSearchChange,
  onAddChapters,
}: NovelDetailChapterPanelProps) {
  const {
    chapters,
    chapterTableProps,
    chapterUiLoading,
    isChaptersPending,
    lastReadChapter,
    selectedIds,
    selectedTranslatableIds,
    selectedActiveIds,
    selectableIds,
    batchStarting,
    batchStopping,
    handleBatchTranslate,
    setSelectedIds,
    setStopSelectedOpen,
    batchRangeFrom,
    batchRangeTo,
    setBatchRangeFrom,
    setBatchRangeTo,
    selectByRange,
    unpublishedCount,
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
  const titleEditing = chapterTableProps.titleEdit !== null;

  return (
    <div className="flex flex-col gap-4">
      <ChapterSearchToolbar
        key={chapterQuery}
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
          selectedTranslatableCount={selectedTranslatableIds.length}
          selectedActiveCount={selectedActiveIds.length}
          batchStarting={batchStarting}
          batchStopping={batchStopping}
          onBatchTranslate={handleBatchTranslate}
          onRequestBatchStop={() => setStopSelectedOpen(true)}
          onClearSelection={() => setSelectedIds(new Set())}
          batchRangeFrom={batchRangeFrom}
          batchRangeTo={batchRangeTo}
          onBatchRangeFromChange={setBatchRangeFrom}
          onBatchRangeToChange={setBatchRangeTo}
          onSelectRange={selectByRange}
          unpublishedCount={unpublishedCount}
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
          tableProps={chapterTableProps}
          initialChapterId={lastReadChapter?.id}
          groupResetKey={chapterQuery}
          onAddChapters={onAddChapters}
        />
      )}
    </div>
  );
}
