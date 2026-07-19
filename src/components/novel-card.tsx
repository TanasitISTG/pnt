import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { NovelCover } from "@/components/novel-cover";

interface Novel {
  id: string;
  title: string;
  originalTitle?: string | null;
  author?: string | null;
  description?: string | null;
  sourceLang: string;
  targetLang: string;
  chapterCount: number;
  translatedCount: number;
  hasCover: number;
}

interface NovelCardProps {
  novel: Novel;
}

export function NovelCard({ novel }: NovelCardProps) {
  const percent =
    novel.chapterCount > 0 ? Math.round((novel.translatedCount / novel.chapterCount) * 100) : 0;

  return (
    <Link
      to="/novels/$novelId"
      params={{ novelId: novel.id }}
      className="no-underline group/card-link block h-full"
    >
      <Card className="hover:border-foreground/40 transition-colors h-full flex flex-col justify-between pt-0">
        <div className="relative aspect-3/4 w-full overflow-hidden bg-foreground/3 border-b border-border flex items-center justify-center">
          <NovelCover
            novelId={novel.hasCover ? novel.id : null}
            alt={novel.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/card-link:scale-[1.02]"
            fallbackSize={12}
          />
          <Badge
            variant="outline"
            className="absolute top-3 left-3 z-20 uppercase font-semibold text-xs border-foreground/40 bg-background/85 backdrop-blur-xs shadow-sm"
          >
            {novel.sourceLang} → {novel.targetLang}
          </Badge>
        </div>
        <CardContent className="flex flex-col gap-3 p-4 flex-1">
          <div className="flex flex-col min-w-0">
            <CardTitle className="text-body-lg font-semibold truncate text-foreground group-hover/card-link:text-foreground/80">
              {novel.title}
            </CardTitle>
            {novel.author && (
              <span className="text-caption text-muted-foreground truncate">{novel.author}</span>
            )}
          </div>
          {novel.description && (
            <p className="text-caption text-muted-foreground line-clamp-2 mt-0.5">
              {novel.description}
            </p>
          )}
          <div className="mt-auto pt-2 flex flex-col gap-1.5">
            <div className="flex justify-between text-caption text-muted-foreground">
              <span>
                {novel.chapterCount} {novel.chapterCount === 1 ? "chapter" : "chapters"}
              </span>
              <span>{percent}%</span>
            </div>
            <Progress value={percent} className="h-1.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
