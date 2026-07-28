import { memo } from "react";

import { cn } from "@/lib/utils";

export function renderParagraph(
  text: string,
  key: React.Key,
  fontSizePx: number,
  readerFontClass?: string,
  dimmed = false,
  lang?: string,
) {
  return (
    <p
      key={key}
      lang={lang}
      className={cn(
        "whitespace-pre-wrap",
        dimmed ? "text-muted-foreground" : "text-foreground",
        readerFontClass,
      )}
      style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
    >
      {text}
    </p>
  );
}

export interface ReaderContentProps {
  hasTranslation: boolean;
  viewMode: "side" | "translated" | "raw";
  aligned: { raw?: string | null; translated?: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  hydrated: boolean;
  sourceLang?: string;
  targetLang?: string;
}

const LANG_NAMES: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  th: "Thai",
};

export const ReaderContent = memo(function ReaderContent({
  hasTranslation,
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  readerFontClass,
  hydrated,
  sourceLang = "zh",
  targetLang = "th",
}: ReaderContentProps) {
  const sourceName = LANG_NAMES[sourceLang];

  return (
    <div style={hydrated ? undefined : { visibility: "hidden" }}>
      {viewMode !== "raw" && hasTranslation && (
        <p className="text-caption text-muted-foreground mb-4">
          {sourceName
            ? `Machine-translated from ${sourceName}. May contain inaccuracies.`
            : "Machine-translated. May contain inaccuracies."}
        </p>
      )}
      {!hasTranslation ? (
        <div className="flex flex-col gap-8">
          <p className="text-caption text-muted-foreground italic">
            Not translated yet — showing raw text.
          </p>
          <div className="mx-auto flex max-w-prose flex-col gap-5">
            {rawParagraphs.map((p, i) =>
              renderParagraph(p, i, fontSizePx, readerFontClass, false, sourceLang),
            )}
          </div>
        </div>
      ) : viewMode === "side" ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {aligned.map((pair, i) => (
            <div key={i} className="contents">
              <div>
                {pair.raw
                  ? renderParagraph(
                      pair.raw,
                      `r-${i}`,
                      fontSizePx,
                      readerFontClass,
                      true,
                      sourceLang,
                    )
                  : null}
              </div>
              <div className="border-b border-border pb-5 md:border-b-0 md:pb-0">
                {pair.translated
                  ? renderParagraph(
                      pair.translated,
                      `t-${i}`,
                      fontSizePx,
                      readerFontClass,
                      false,
                      targetLang,
                    )
                  : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto flex max-w-prose flex-col gap-5">
          {(viewMode === "translated" ? translatedParagraphs : rawParagraphs).map((p, i) =>
            renderParagraph(
              p,
              i,
              fontSizePx,
              readerFontClass,
              false,
              viewMode === "raw" ? sourceLang : targetLang,
            ),
          )}
        </div>
      )}
    </div>
  );
});
