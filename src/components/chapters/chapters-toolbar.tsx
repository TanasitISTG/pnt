import { ChapterActionsControls } from "./chapter-actions-controls";
import { ChapterSelectionControls } from "./chapter-selection-controls";

export interface ChaptersToolbarProps {
  isAdmin: boolean;
  selectedCount: number;
  hiddenSelectedCount: number;
  selectableCount: number;
  selectedTranslatableCount: number;
  selectedActiveCount: number;
  batchStarting: boolean;
  batchStopping: boolean;
  onBatchTranslate: () => void;
  onRequestBatchStop: () => void;
  onClearSelection: () => void;
  batchRangeFrom: string;
  batchRangeTo: string;
  onBatchRangeFromChange: (value: string) => void;
  onBatchRangeToChange: (value: string) => void;
  onSelectRange: () => void;
  unpublishedCount: number;
  onPublishAll: () => void;
  publishingAll: boolean;
  missingTitleCount: number;
  onBackfillTitles: () => void;
  backfillingTitles: boolean;
  chapterCount: number;
  onReorderChapters: () => void;
  reorderDisabled: boolean;
  deletingAllTranslations: boolean;
  onDeleteAllTranslations: () => void;
}

export function ChaptersToolbar({
  isAdmin,
  selectedCount,
  hiddenSelectedCount,
  selectableCount,
  selectedTranslatableCount,
  selectedActiveCount,
  batchStarting,
  batchStopping,
  onBatchTranslate,
  onRequestBatchStop,
  onClearSelection,
  batchRangeFrom,
  batchRangeTo,
  onBatchRangeFromChange,
  onBatchRangeToChange,
  onSelectRange,
  unpublishedCount,
  onPublishAll,
  publishingAll,
  missingTitleCount,
  onBackfillTitles,
  backfillingTitles,
  chapterCount,
  onReorderChapters,
  reorderDisabled,
  deletingAllTranslations,
  onDeleteAllTranslations,
}: ChaptersToolbarProps) {
  if (!isAdmin) return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <ChapterSelectionControls
        selectedCount={selectedCount}
        hiddenSelectedCount={hiddenSelectedCount}
        selectableCount={selectableCount}
        selectedTranslatableCount={selectedTranslatableCount}
        selectedActiveCount={selectedActiveCount}
        batchStarting={batchStarting}
        batchStopping={batchStopping}
        onBatchTranslate={onBatchTranslate}
        onRequestBatchStop={onRequestBatchStop}
        onClearSelection={onClearSelection}
        batchRangeFrom={batchRangeFrom}
        batchRangeTo={batchRangeTo}
        onBatchRangeFromChange={onBatchRangeFromChange}
        onBatchRangeToChange={onBatchRangeToChange}
        onSelectRange={onSelectRange}
      />
      <ChapterActionsControls
        unpublishedCount={unpublishedCount}
        onPublishAll={onPublishAll}
        publishingAll={publishingAll}
        missingTitleCount={missingTitleCount}
        onBackfillTitles={onBackfillTitles}
        backfillingTitles={backfillingTitles}
        chapterCount={chapterCount}
        onReorderChapters={onReorderChapters}
        reorderDisabled={reorderDisabled}
        deletingAllTranslations={deletingAllTranslations}
        onDeleteAllTranslations={onDeleteAllTranslations}
      />
    </div>
  );
}
