import { useMemo } from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChapterGroupsAccordion } from "@/components/chapters/chapter-groups-accordion";
import { ChapterTable, type ChapterTableProps } from "@/components/chapters/chapter-table";
import type { ChapterRow } from "./types";

const CHAPTER_GROUP_SIZE = 50;

export interface ChaptersTableSectionProps {
  chapters: ChapterRow[];
  isAdmin: boolean;
  loading: boolean;
  tableProps: Omit<ChapterTableProps, "chapters">;
  initialChapterId?: string | null;
  groupResetKey?: string;
  onAddChapters?: () => void;
}

export function ChaptersTableSection({
  chapters,
  isAdmin,
  loading,
  tableProps,
  initialChapterId,
  groupResetKey = "",
  onAddChapters,
}: ChaptersTableSectionProps) {
  const chapterGroups = useMemo(() => {
    const groups: ChapterRow[][] = [];
    for (let i = 0; i < chapters.length; i += CHAPTER_GROUP_SIZE) {
      groups.push(chapters.slice(i, i + CHAPTER_GROUP_SIZE));
    }
    return groups;
  }, [chapters]);
  const initialGroupIndex = useMemo(() => {
    if (!initialChapterId) return 0;
    const chapterIndex = chapters.findIndex((chapter) => chapter.id === initialChapterId);
    return chapterIndex >= 0 ? Math.floor(chapterIndex / CHAPTER_GROUP_SIZE) : 0;
  }, [chapters, initialChapterId]);

  if (loading) {
    return (
      <div
        className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Loading chapters…
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
        <FileText className="mb-2 size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "No chapters in this novel yet." : "No chapters published yet."}
        </p>
        {isAdmin && onAddChapters ? (
          <Button type="button" variant="outline" className="mt-5" onClick={onAddChapters}>
            <Plus className="size-4" />
            Add chapters
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {chapterGroups.length <= 1 ? (
        <ChapterTable chapters={chapters} {...tableProps} />
      ) : (
        <ChapterGroupsAccordion
          key={groupResetKey}
          groups={chapterGroups}
          initialGroupIndex={initialGroupIndex}
          isAdmin={isAdmin}
          tableProps={tableProps}
        />
      )}
    </div>
  );
}
