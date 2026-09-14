export type ReaderTranslationStatus = "idle" | "queued" | "running" | "error" | "cancelled";

export interface ReaderContentProps {
  hasTranslation: boolean;
  viewMode: "side" | "translated" | "raw";
  aligned: { raw?: string | null; translated?: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  sourceLang?: string;
  targetLang?: string;
  isAdmin?: boolean;
  translationStatus?: ReaderTranslationStatus;
  jobRunning?: boolean;
  onTranslateRequest?: () => void;
  onEditRequest?: () => void;
}
