import {
  createReaderParagraphEntries,
  createReaderParagraphPairEntries,
} from "./reader-content-keys";
import { renderParagraph } from "./render-paragraph";

interface ReaderProseProps {
  paragraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  lang: string;
  dimmed?: boolean;
}

export function ReaderProse({
  paragraphs,
  fontSizePx,
  readerFontClass,
  lang,
  dimmed = false,
}: ReaderProseProps) {
  const entries = createReaderParagraphEntries(paragraphs);

  return (
    <div className="mx-auto flex max-w-prose flex-col gap-5" style={{ fontSize: fontSizePx }}>
      {entries.map(({ key, paragraph }, index) =>
        renderParagraph(
          paragraph,
          key,
          readerFontClass,
          dimmed,
          lang,
          `reader-paragraph-${index + 1}`,
        ),
      )}
    </div>
  );
}

interface ReaderComparisonProps {
  aligned: { raw?: string | null; translated?: string | null }[];
  fontSizePx: number;
  readerFontClass?: string;
  sourceLang: string;
  sourceName?: string;
  targetLang: string;
  targetName: string;
}

export function ReaderComparison({
  aligned,
  fontSizePx,
  readerFontClass,
  sourceLang,
  sourceName,
  targetLang,
  targetName,
}: ReaderComparisonProps) {
  const entries = createReaderParagraphPairEntries(aligned);
  return (
    <div className="flex flex-col gap-5" style={{ fontSize: fontSizePx }}>
      {entries.map(({ key, pair }, index) => (
        <div
          key={key}
          id={`reader-pair-${index + 1}`}
          className="scroll-mt-20 grid gap-4 border-b border-border pb-5 last:border-b-0 md:grid-cols-2 md:gap-8 md:pb-0"
        >
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted-foreground">
              {sourceName ?? sourceLang}
            </p>
            {pair.raw
              ? renderParagraph(
                  pair.raw,
                  `${key}-raw`,
                  readerFontClass,
                  true,
                  sourceLang,
                  `reader-paragraph-${index + 1}-raw`,
                )
              : null}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted-foreground">{targetName}</p>
            {pair.translated
              ? renderParagraph(
                  pair.translated,
                  `${key}-translated`,
                  readerFontClass,
                  false,
                  targetLang,
                  `reader-paragraph-${index + 1}-translated`,
                )
              : null}
          </div>
        </div>
      ))}
    </div>
  );
}
