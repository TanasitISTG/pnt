import { useMemo } from "react";
import { FileText } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChapterTable, type ChapterRow, type ChapterTableProps } from "@/components/chapter-table";

const CHAPTER_GROUP_SIZE = 50;

export interface ChaptersTableSectionProps {
  chapters: ChapterRow[];
  isAdmin: boolean;
  tableProps: Omit<ChapterTableProps, "chapters">;
}

export function ChaptersTableSection({ chapters, isAdmin, tableProps }: ChaptersTableSectionProps) {
  const chapterGroups = useMemo(() => {
    const groups: ChapterRow[][] = [];
    for (let i = 0; i < chapters.length; i += CHAPTER_GROUP_SIZE) {
      groups.push(chapters.slice(i, i + CHAPTER_GROUP_SIZE));
    }
    return groups;
  }, [chapters]);

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
        <FileText className="size-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "No chapters in this novel yet. Paste one below to start."
            : "No chapters published yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {chapterGroups.length <= 1 ? (
        <ChapterTable chapters={chapters} {...tableProps} />
      ) : (
        <Accordion multiple defaultValue={[0]}>
          {chapterGroups.map((group, gi) => (
            <AccordionItem key={gi} value={gi}>
              <AccordionTrigger>
                <span>
                  Chapters {Number(group[0].number)}–{Number(group[group.length - 1].number)}
                  <span className="ml-2 font-normal text-muted-foreground">({group.length})</span>
                </span>
              </AccordionTrigger>
              <AccordionPanel>
                <ChapterTable chapters={group} {...tableProps} />
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
