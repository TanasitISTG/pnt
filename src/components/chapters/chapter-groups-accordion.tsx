import { useState } from "react";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ChapterTable, type ChapterTableProps } from "@/components/chapters/chapter-table";
import type { ChapterRow } from "@/components/chapters/types";

interface ChapterGroupsAccordionProps {
  groups: ChapterRow[][];
  initialGroupIndex: number;
  isAdmin: boolean;
  tableProps: Omit<ChapterTableProps, "chapters">;
}

export function ChapterGroupsAccordion({
  groups,
  initialGroupIndex,
  isAdmin,
  tableProps,
}: ChapterGroupsAccordionProps) {
  const [userValue, setUserValue] = useState<number[] | null>(null);
  const value = userValue ?? [initialGroupIndex];

  return (
    <Accordion value={value} onValueChange={setUserValue} {...(!isAdmin ? { multiple: true } : {})}>
      {groups.map((group, groupIndex) => (
        <AccordionItem key={groupIndex} value={groupIndex}>
          <AccordionTrigger>
            <span>
              Chapters {Number(group[0].number)}–{Number(group[group.length - 1].number)}{" "}
              <span className="ml-2 font-normal text-muted-foreground">({group.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionPanel>
            <ChapterTable chapters={group} {...tableProps} />
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
