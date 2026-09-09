import { ReaderProse } from "./reader-content-prose";

interface ReaderUntranslatedContentProps {
  rawParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  sourceLang: string;
}

export function ReaderUntranslatedContent({
  rawParagraphs,
  fontSizePx,
  readerFontClass,
  sourceLang,
}: ReaderUntranslatedContentProps) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-caption italic text-muted-foreground">
        Not translated yet — showing raw text.
      </p>
      <ReaderProse
        paragraphs={rawParagraphs}
        fontSizePx={fontSizePx}
        readerFontClass={readerFontClass}
        lang={sourceLang}
      />
    </div>
  );
}
