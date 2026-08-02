import type { chapterStatusEnum } from "@/lib/db/schema";

export type ChapterStatus = (typeof chapterStatusEnum.enumValues)[number];

export interface ChapterRow {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
  status: ChapterStatus;
  rawCharCount: number;
  publishedAt: Date | string | null;
  editedAt: Date | string | null;
}
