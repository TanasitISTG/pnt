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
    <div className="flex items-baseline gap-3 border-b border-border pb-4">
      <span className="text-caption text-muted-foreground font-mono">Ch. {Number(number)}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-card-title font-semibold text-foreground tracking-tight">
          {translatedTitle ?? title}
        </h1>
        {translatedTitle && translatedTitle !== title && (
          <span className="text-caption text-muted-foreground">{title}</span>
        )}
      </div>
      {editedAt && (
        <Badge variant="secondary" className="text-[10px]">
          Edited
        </Badge>
      )}
    </div>
  );
}
