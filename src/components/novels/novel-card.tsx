import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { NovelCover } from "@/components/novels/novel-cover";
import { publishState, type PublishState } from "@/lib/content/publish";
import type { LibraryNovel } from "@/components/novels/library-search";

interface NovelCardProps {
  novel: LibraryNovel;
  view: "grid" | "list";
  isAdmin: boolean;
  lazyCover?: boolean;
  priorityCover?: boolean;
}
function formatPublicationState(state: PublishState): string {
  return state === "live" ? "Live" : state === "scheduled" ? "Scheduled" : "Draft";
}

export function NovelCard({
  novel,
  view,
  isAdmin,
  lazyCover = true,
  priorityCover = false,
}: NovelCardProps) {
  const percent =
    novel.chapterCount > 0 ? Math.round((novel.translatedCount / novel.chapterCount) * 100) : 0;
  const state = publishState(novel.publishedAt);
  const isList = view === "list";

  return (
    <Link
      to="/novels/$novelId"
      params={{ novelId: novel.id }}
      className="group/card-link block h-full no-underline"
    >
      <Card
        className={
          isList
            ? "h-full transition-colors hover:border-foreground/40"
            : "h-full pt-0 transition-colors hover:border-foreground/40"
        }
      >
        <div
          className={
            isList
              ? "flex min-w-0 gap-4 p-3 sm:gap-5 sm:p-4"
              : "flex h-full flex-col justify-between"
          }
        >
          <div
            className={
              isList
                ? "relative h-24 w-16 shrink-0 overflow-hidden rounded-md bg-foreground/3 sm:h-30 sm:w-20"
                : "relative aspect-3/4 w-full overflow-hidden border-b border-border bg-foreground/3"
            }
          >
            <NovelCover
              novelId={novel.hasCover ? novel.id : null}
              coverVersion={novel.updatedAt}
              lazy={lazyCover}
              priority={priorityCover}
              sizes={
                isList
                  ? "(max-width: 639px) 64px, 80px"
                  : "(max-width: 767px) calc(50vw - 34px), (max-width: 1023px) calc(33.333vw - 32px), 270px"
              }
              alt={novel.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover/card-link:scale-[1.02]"
              fallbackSize={isList ? 7 : 12}
            />
          </div>
          <CardContent
            className={
              isList ? "flex min-w-0 flex-1 flex-col gap-2 p-0" : "flex flex-1 flex-col gap-3 p-4"
            }
          >
            <div className="min-w-0">
              <CardTitle className="line-clamp-2 text-body-lg font-semibold text-foreground group-hover/card-link:text-foreground/80">
                {novel.title}
              </CardTitle>
              <p className="mt-1 truncate text-caption text-muted-foreground">
                {novel.sourceLang} → {novel.targetLang}
                {novel.author ? ` · ${novel.author}` : ""}
              </p>
            </div>
            {novel.description && !isList && (
              <p className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
                {novel.description}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-1.5 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
                <span>
                  {novel.chapterCount} {novel.chapterCount === 1 ? "chapter" : "chapters"} ·{" "}
                  {novel.translatedCount} translated
                </span>
                {isAdmin && <Badge variant="outline">{formatPublicationState(state)}</Badge>}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Progress
                    value={percent}
                    aria-label={`${novel.title} translation progress`}
                    className="h-1.5"
                  />
                  <span className="shrink-0 text-caption text-muted-foreground">{percent}%</span>
                </div>
              )}
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}
