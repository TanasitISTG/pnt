import type { Ref } from "react";

import type { ReaderColumn } from "@/lib/reader/types";
import type { ReaderParagraphHighlights } from "@/lib/reader/search";

export type ReaderTranslationStatus = "idle" | "queued" | "running" | "error" | "cancelled";

export type ReaderHighlightsLookup = (
  paragraphIndex: number,
  column: ReaderColumn | null,
) => ReaderParagraphHighlights | undefined;

export interface ReaderContentProps {
  hasTranslation: boolean;
  viewMode: "side" | "translated" | "raw";
  aligned: { raw?: string | null; translated?: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  lineHeight: number;
  measureRem: number;
  readerFontClass?: string;
  sourceLang?: string;
  targetLang?: string;
  isAdmin?: boolean;
  translationStatus?: ReaderTranslationStatus;
  jobRunning?: boolean;
  highlightsFor?: ReaderHighlightsLookup;
  // The outer prose node, measured for reader progress and restore.
  proseRef?: Ref<HTMLDivElement>;
  onTranslateRequest?: () => void;
  onEditRequest?: () => void;
}
