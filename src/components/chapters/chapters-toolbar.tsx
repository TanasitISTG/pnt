import { ChapterActionsControls } from "./chapter-actions-controls";
import { ChapterSelectionControls } from "./chapter-selection-controls";

export interface ChaptersToolbarProps {
  isAdmin: boolean;
  selectedCount: number;
  hiddenSelectedCount: number;
  selectableCount: number;
  selectedMissingCount: number;
  selectedTranslatedCount: number;
  selectedActiveCount: number;
  batchStarting: boolean;
  batchStopping: boolean;
  onBatchTranslate: () => void;
  onRequestBatchRetranslate: () => void;
  onRequestBatchStop: () => void;
  onClearSelection: () => void;
  batchRangeFrom: string;
  batchRangeTo: string;
  onBatchRangeFromChange: (value: string) => void;
  onBatchRangeToChange: (value: string) => void;
  onSelectRange: () => void;
  readyUnpublishedCount: number;
  unreadyCount: number;
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
  selectedMissingCount,
  selectedTranslatedCount,
  selectedActiveCount,
  batchStarting,
  batchStopping,
  onBatchTranslate,
  onRequestBatchRetranslate,
  onRequestBatchStop,
  onClearSelection,
  batchRangeFrom,
  batchRangeTo,
  onBatchRangeFromChange,
  onBatchRangeToChange,
  onSelectRange,
  readyUnpublishedCount,
  unreadyCount,
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
        selectedMissingCount={selectedMissingCount}
        selectedTranslatedCount={selectedTranslatedCount}
        selectedActiveCount={selectedActiveCount}
        batchStarting={batchStarting}
        batchStopping={batchStopping}
        onBatchTranslate={onBatchTranslate}
        onRequestBatchRetranslate={onRequestBatchRetranslate}
        onRequestBatchStop={onRequestBatchStop}
        onClearSelection={onClearSelection}
        batchRangeFrom={batchRangeFrom}
        batchRangeTo={batchRangeTo}
        onBatchRangeFromChange={onBatchRangeFromChange}
        onBatchRangeToChange={onBatchRangeToChange}
        onSelectRange={onSelectRange}
      />
      <ChapterActionsControls
        readyUnpublishedCount={readyUnpublishedCount}
        unreadyCount={unreadyCount}
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
