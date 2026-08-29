import { memo, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Sortable, type SortableCommitMeta } from "@/components/ui/sortable";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TitleEditState } from "@/components/chapters/use-chapter-title-edit";
import { ChapterTableRow } from "./chapter-table-row";
import type { ChapterRow } from "./types";
import type { NovelCostData, ActiveJobState } from "@/lib/translation/translation.types";

type OptimisticChapterOrder = {
  version: string;
  value: ChapterRow[];
};

function getChapterVersion(chapters: ChapterRow[]): string {
  return chapters
    .map((chapter) =>
      [
        chapter.id,
        chapter.number,
        chapter.title,
        chapter.translatedTitle ?? "",
        chapter.status,
        chapter.rawCharCount,
        chapter.publishedAt ?? "",
        chapter.editedAt ?? "",
      ].join(":"),
    )
    .join("|");
}
const getChapterItemValue = (chapter: ChapterRow) => chapter.id;
type CostData = NovelCostData | undefined;

export interface ChapterTableProps {
  chapters: ChapterRow[];
  novelId: string;
  isAdmin: boolean;
  activeJobs: Map<string, ActiveJobState>;
  readChapterIdSet: ReadonlySet<string>;
  residualHanziMap: Map<string, number>;
  costData: CostData;
  selectedIds: Set<string>;
  allSelected: boolean;
  isTranslating: (chapterId: string, status: string) => boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  publishingChapterId: string | null;
  onPublishChapter: (vars: { chapterId: string; publishedAt: Date | null }) => void;
  onCancelTranslate: (jobId: string, chapterId: string) => void;
  onRetryTranslate: (jobId: string, chapterId: string) => void;
  onStartTranslate: (chapterId: string) => void;
  onRequestRetranslate: (chapterId: string) => void;
  onViewLogs: (chapterId: string) => void;
  editingChapterId: string | null;
  titleEdit: TitleEditState | null;
  editErrors: Record<string, string>;
  onSaveTitle: () => void;
  savingTitle: boolean;
  onTitleChange: (value: string) => void;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
  reorderingChapters: boolean;
  onReorderChapters: (chapterIds: string[]) => Promise<unknown>;
  refetchChapters: () => Promise<unknown>;
}

function assignNumberSlots(next: ChapterRow[], previous: ChapterRow[]): ChapterRow[] {
  return next.map((chapter, index) => ({
    ...chapter,
    number: previous[index]?.number ?? chapter.number,
  }));
}

export const ChapterTable = memo(function ChapterTable({
  chapters,
  novelId,
  isAdmin,
  activeJobs,
  readChapterIdSet,
  residualHanziMap,
  costData,
  selectedIds,
  allSelected,
  isTranslating,
  onToggleSelect,
  onToggleSelectAll,
  publishingChapterId,
  onPublishChapter,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
  onViewLogs,
  editingChapterId,
  titleEdit,
  editErrors,
  savingTitle,
  onTitleChange,
  onSaveTitle,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
  reorderingChapters,
  onReorderChapters,
  refetchChapters,
}: ChapterTableProps) {
  const chapterVersion = useMemo(() => getChapterVersion(chapters), [chapters]);
  const [optimisticOrder, setOptimisticOrder] = useState<OptimisticChapterOrder | null>(null);
  const orderedChapters =
    optimisticOrder?.version === chapterVersion ? optimisticOrder.value : chapters;
  const dragSlotsRef = useRef<string[]>([]);

  const hasActiveTranslation = orderedChapters.some((chapter) =>
    isTranslating(chapter.id, chapter.status),
  );
  const sortingDisabled =
    !isAdmin || reorderingChapters || editingChapterId !== null || hasActiveTranslation;

  const handleDragStart = useCallback(() => {
    dragSlotsRef.current = orderedChapters.map((chapter) => chapter.number);
  }, [orderedChapters]);

  const handleValueChange = useCallback(
    (nextValue: ChapterRow[]) => {
      const slots =
        dragSlotsRef.current.length === nextValue.length
          ? dragSlotsRef.current
          : orderedChapters.map((chapter) => chapter.number);
      const nextOrder = nextValue.map((chapter, index) => ({
        ...chapter,
        number: slots[index] ?? chapter.number,
      }));
      setOptimisticOrder({ version: chapterVersion, value: nextOrder });
    },
    [chapterVersion, orderedChapters],
  );

  const handleValueCommit = useCallback(
    (nextValue: ChapterRow[], meta: SortableCommitMeta<ChapterRow>) => {
      const optimisticValue = assignNumberSlots(nextValue, meta.previousValue);
      setOptimisticOrder({ version: chapterVersion, value: optimisticValue });
      dragSlotsRef.current = [];

      const persist = async () => {
        try {
          await onReorderChapters(optimisticValue.map((chapter) => chapter.id));
        } catch (error) {
          setOptimisticOrder({ version: chapterVersion, value: meta.previousValue });
          await refetchChapters();
          toast.error(
            error instanceof Error
              ? error.message
              : "Chapter order could not be saved. Refresh and try again.",
          );
        }
      };
      void persist();
    },
    [chapterVersion, onReorderChapters, refetchChapters],
  );

  const rows = orderedChapters.map((chapter) => {
    const activeJob = activeJobs.get(chapter.id);
    const isRowTranslating = isTranslating(chapter.id, chapter.status);
    const isTitleEditing = titleEdit?.chapterId === chapter.id;

    return (
      <ChapterTableRow
        key={chapter.id}
        chapter={chapter}
        novelId={novelId}
        isAdmin={isAdmin}
        activeJob={activeJob}
        isRead={readChapterIdSet.has(chapter.id)}
        residualCount={residualHanziMap.get(chapter.id)}
        chapterCost={costData?.costs[chapter.id]}
        selected={selectedIds.has(chapter.id)}
        isRowTranslating={isRowTranslating}
        isTitleEditing={isTitleEditing}
        titleEdit={isTitleEditing ? titleEdit : null}
        editError={isTitleEditing ? editErrors.translatedTitle : undefined}
        savingTitle={isTitleEditing ? savingTitle : false}
        sortingDisabled={sortingDisabled}
        publishingChapter={publishingChapterId === chapter.id}
        onToggleSelect={onToggleSelect}
        onPublishChapter={onPublishChapter}
        onCancelTranslate={onCancelTranslate}
        onRetryTranslate={onRetryTranslate}
        onStartTranslate={onStartTranslate}
        onRequestRetranslate={onRequestRetranslate}
        onViewLogs={onViewLogs}
        onSaveTitle={isTitleEditing ? onSaveTitle : undefined}
        onTitleChange={onTitleChange}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onDeleteChapter={onDeleteChapter}
      />
    );
  });
  const tableBody = isAdmin ? (
    <Sortable<ChapterRow>
      value={orderedChapters}
      onValueChange={handleValueChange}
      onValueCommit={handleValueCommit}
      getItemValue={getChapterItemValue}
      onDragStart={handleDragStart}
      render={<TableBody />}
      renderOverlay={(value) => {
        const chapter = orderedChapters.find((item) => item.id === String(value));
        return chapter ? (
          <div className="flex min-w-56 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lg">
            <span className="font-mono text-muted-foreground">{Number(chapter.number)}</span>
            <span className="truncate font-medium">{chapter.translatedTitle ?? chapter.title}</span>
          </div>
        ) : null;
      }}
    >
      {rows}
    </Sortable>
  ) : (
    <TableBody>{rows}</TableBody>
  );

  return (
    <div>
      {isAdmin && reorderingChapters && (
        <p className="px-3 py-2 text-caption text-muted-foreground" aria-live="polite">
          Saving chapter order…
        </p>
      )}
      <Table>
        {isAdmin && (
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" aria-hidden="true" />
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  aria-label="Select all chapters"
                  className="size-4 accent-primary align-middle"
                />
              </TableHead>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-32 hidden sm:table-cell">Chars</TableHead>
              <TableHead className="w-32 hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
        )}
        {tableBody}
      </Table>
    </div>
  );
});
