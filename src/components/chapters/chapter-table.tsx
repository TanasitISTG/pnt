import { memo, useMemo } from "react";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TitleEditState } from "@/components/chapters/use-chapter-title-edit";
import { ChapterTableRow } from "./chapter-table-row";
import type { ChapterRow } from "./types";
import type { NovelCostData, ActiveJobState } from "@/lib/translation/types/api";

type CostData = NovelCostData | undefined;

export interface ChapterTableProps {
  chapters: ChapterRow[];
  novelId: string;
  isAdmin: boolean;
  activeJobs: Map<string, ActiveJobState>;
  readChapterIdSet: ReadonlySet<string>;
  residualScriptMap: Map<string, number>;
  costData: CostData;
  selectedIds: Set<string>;
  isTranslating: (chapterId: string, status: string) => boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (chapterIds: string[], checked: boolean) => void;
  publishingChapterId: string | null;
  onPublishChapter: (vars: { chapterId: string; publishedAt: Date | null }) => void;
  onCancelTranslate: (jobId: string, chapterId: string) => void;
  onRetryTranslate: (jobId: string, chapterId: string) => void;
  onStartTranslate: (chapterId: string) => void;
  onRequestRetranslate: (chapterId: string) => void;
  onViewLogs: (chapterId: string) => void;
  titleEdit: TitleEditState | null;
  editErrors: Record<string, string>;
  onSaveTitle: () => void;
  savingTitle: boolean;
  onTitleChange: (value: string) => void;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
}

export const ChapterTable = memo(function ChapterTable({
  chapters,
  novelId,
  isAdmin,
  activeJobs,
  readChapterIdSet,
  residualScriptMap,
  costData,
  selectedIds,
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
  titleEdit,
  editErrors,
  savingTitle,
  onTitleChange,
  onSaveTitle,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
}: ChapterTableProps) {
  const selectableIds = useMemo(
    () =>
      chapters.flatMap((chapter) =>
        isTranslating(chapter.id, chapter.status) ? [] : [chapter.id],
      ),
    [chapters, isTranslating],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const rows = chapters.map((chapter) => {
    const activeJob = activeJobs.get(chapter.id);
    const isRowTranslating = isTranslating(chapter.id, chapter.status);
    const titleEditForRow = titleEdit?.chapterId === chapter.id ? titleEdit : null;

    return (
      <ChapterTableRow
        key={chapter.id}
        chapter={chapter}
        novelId={novelId}
        viewer={isAdmin ? "admin" : "guest"}
        activeJob={activeJob}
        readState={readChapterIdSet.has(chapter.id) ? "read" : "unread"}
        residualScriptCount={residualScriptMap.get(chapter.id)}
        chapterCost={costData?.costs[chapter.id]}
        selected={selectedIds.has(chapter.id)}
        translationState={isRowTranslating ? "translating" : "idle"}
        titleEdit={titleEditForRow}
        editError={titleEditForRow ? editErrors.translatedTitle : undefined}
        savingTitle={titleEditForRow ? savingTitle : false}
        publishingChapter={publishingChapterId === chapter.id}
        onToggleSelect={onToggleSelect}
        onPublishChapter={onPublishChapter}
        onCancelTranslate={onCancelTranslate}
        onRetryTranslate={onRetryTranslate}
        onStartTranslate={onStartTranslate}
        onRequestRetranslate={onRequestRetranslate}
        onViewLogs={onViewLogs}
        onSaveTitle={titleEditForRow ? onSaveTitle : undefined}
        onTitleChange={onTitleChange}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onDeleteChapter={onDeleteChapter}
      />
    );
  });

  return (
    <div>
      <Table>
        {isAdmin && (
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(selectableIds, e.target.checked)}
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
        <TableBody>{rows}</TableBody>
      </Table>
    </div>
  );
});
