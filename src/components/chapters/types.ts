import type { chapterStatusEnum } from "@/lib/db/schema";

export type ChapterStatus = (typeof chapterStatusEnum.enumValues)[number];

export interface ChapterRow {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
  hasTranslation: boolean;
  /**
   * Whether the chapter has any recorded generation at all, live translation or not. A bulk
   * delete clears the text but not the trail, and this is what keeps the way back on the row
   * after the text is gone.
   */
  hasHistory: boolean;
  status: ChapterStatus;
  rawCharCount: number;
  publishedAt: Date | string | null;
  editedAt: Date | string | null;
}
