import { cn } from "@/lib/utils";

export function renderParagraph(
  text: string,
  key: React.Key,
  readerFontClass?: string,
  dimmed = false,
  lang?: string,
  id?: string,
) {
  return (
    <p
      id={id}
      key={key}
      lang={lang}
      className={cn(
        "scroll-mt-20 whitespace-pre-wrap break-words",
        dimmed ? "text-muted-foreground" : "text-foreground",
        readerFontClass,
      )}
      style={{
        lineHeight: 1.75,
        overflowWrap: "anywhere",
        contentVisibility: "auto",
        containIntrinsicSize: "auto 6rem",
      }}
    >
      {text}
    </p>
  );
}
