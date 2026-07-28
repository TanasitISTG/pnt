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
