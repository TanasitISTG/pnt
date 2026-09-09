import { cn } from "@/lib/utils";

export function renderParagraph(
  text: string,
  key: React.Key,
  readerFontClass?: string,
  dimmed = false,
  lang?: string,
) {
  return (
    <p
      key={key}
      lang={lang}
      className={cn(
        "whitespace-pre-wrap break-words",
        dimmed ? "text-muted-foreground" : "text-foreground",
        readerFontClass,
      )}
      style={{ lineHeight: 1.75, overflowWrap: "anywhere" }}
    >
      {text}
    </p>
  );
}
