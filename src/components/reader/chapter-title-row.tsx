import { Badge } from "@/components/ui/badge";

export interface ChapterTitleRowProps {
  number: string;
  title: string;
  translatedTitle: string | null;
  editedAt: Date | string | null;
}

export function ChapterTitleRow({
  number,
  title,
  translatedTitle,
  editedAt,
}: ChapterTitleRowProps) {
  return (
    <div className="flex min-w-0 max-w-full items-start gap-3 border-b border-border pb-4">
      <span className="shrink-0 whitespace-nowrap font-mono text-caption text-muted-foreground">
        Ch. {Number(number)}
      </span>
      <div className="flex min-w-0 max-w-full flex-1 flex-col gap-0.5">
        <h1 className="min-w-0 max-w-full break-words text-card-title font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
          {translatedTitle ?? title}
        </h1>
        {translatedTitle && translatedTitle !== title && (
          <span className="max-w-full break-words text-caption text-muted-foreground [overflow-wrap:anywhere]">
            {title}
          </span>
        )}
      </div>
      {editedAt && (
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          Edited
        </Badge>
      )}
    </div>
  );
}
