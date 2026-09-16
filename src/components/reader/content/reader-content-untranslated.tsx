import { Button } from "@/components/ui/button";
import type { ReaderTranslationStatus } from "./reader-content-types";
import { ReaderProse } from "./reader-content-prose";

interface ReaderUntranslatedContentProps {
  rawParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  sourceLang: string;
  isAdmin?: boolean;
  translationStatus?: ReaderTranslationStatus;
  jobRunning?: boolean;
  onTranslateRequest?: () => void;
  onEditRequest?: () => void;
}

export function ReaderUntranslatedContent({
  rawParagraphs,
  fontSizePx,
  readerFontClass,
  sourceLang,
  isAdmin = false,
  translationStatus = "idle",
  jobRunning = false,
  onTranslateRequest,
  onEditRequest,
}: ReaderUntranslatedContentProps) {
  const retrying = translationStatus === "error" || translationStatus === "cancelled";
  return (
    <div className="flex flex-col gap-8">
      <p className="text-caption italic text-muted-foreground">
        Not translated yet — showing raw text.
      </p>
      {isAdmin && onTranslateRequest ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onTranslateRequest} disabled={jobRunning}>
            {jobRunning
              ? "Translation in progress…"
              : retrying
                ? "Retry translation"
                : "Translate this chapter"}
          </Button>
          {onEditRequest ? (
            <Button type="button" variant="outline" onClick={onEditRequest} disabled={jobRunning}>
              Edit chapter
            </Button>
          ) : null}
          {jobRunning ? (
            <span className="text-caption text-muted-foreground">
              This runs on the server; you can safely leave this page.
            </span>
          ) : null}
        </div>
      ) : null}
      <ReaderProse
        paragraphs={rawParagraphs}
        fontSizePx={fontSizePx}
        readerFontClass={readerFontClass}
        lang={sourceLang}
      />
    </div>
  );
}
