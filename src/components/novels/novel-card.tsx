import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useTranslations } from "use-intl";

import { NovelCover } from "@/components/novels/novel-cover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LangPair } from "@/components/ui/lang-pair";
import { publishState, type PublishState } from "@/lib/content/publish/publish";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import type { LibraryNovel } from "@/components/novels/library/library-search";

interface NovelCardProps {
  novel: LibraryNovel;
  view: "grid" | "list";
  isAdmin: boolean;
  lazyCover?: boolean;
  priorityCover?: boolean;
}

/** The `catalog` key for a publication state, so the badge reads in the reader's language. */
function publicationStateKey(state: PublishState): "stateLive" | "stateScheduled" | "stateDraft" {
  return state === "live" ? "stateLive" : state === "scheduled" ? "stateScheduled" : "stateDraft";
}

/**
 * The shelf card. Cover-forward, with the language pair as the metadata that matters
 * (it is what the product does) and exactly one progress statement — the old card spent
 * two definition-list rows saying "chapters" and "translated" separately.
 *
 * The transition into the novel page is opt-in per navigation: a spatial move between
 * two related surfaces, which is the only place a route transition earns its keep.
 */
export function NovelCard({
  novel,
  view,
  isAdmin,
  lazyCover = true,
  priorityCover = false,
}: NovelCardProps) {
  const t = useTranslations("catalog");
  // The card is the same component in the catalog and on the shelf, and the shelf has no
  // language in its URL, so the language is passed rather than inherited.
  const localized = useLocalizedParams();
  const percent =
    novel.chapterCount > 0 ? Math.round((novel.translatedCount / novel.chapterCount) * 100) : 0;
  const state = publishState(novel.publishedAt);
  const isList = view === "list";

  return (
    <Link
      to="/{-$locale}/novels/$novelId"
      params={{ novelId: novel.id, ...localized }}
      viewTransition
      // A link wrapping the card's block content computes an empty accessible name in
      // Chromium (HTML-AAM), which left every shelf card an unnamed link. Naming it here
      // gives a screen reader the two things that identify the novel: title and pair.
      aria-label={t("cardLabel", {
        title: novel.title,
        source: novel.sourceLang.toUpperCase(),
        target: novel.targetLang.toUpperCase(),
      })}
      className="group/card-link block h-full no-underline"
    >
      <article
        className={
          isList
            ? "flex h-full items-stretch gap-4 rounded-xl border border-border bg-card p-3 transition-colors duration-micro group-hover/card-link:border-border-strong sm:gap-5 sm:p-4"
            : "flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors duration-micro group-hover/card-link:border-border-strong"
        }
      >
        <div
          className={
            isList
              ? "relative h-24 w-16 shrink-0 overflow-hidden rounded-md bg-surface-inset sm:h-28 sm:w-[4.75rem]"
              : "relative aspect-3/4 w-full shrink-0 overflow-hidden border-b border-border bg-surface-inset"
          }
        >
          <NovelCover
            novelId={novel.hasCover ? novel.id : null}
            coverVersion={novel.updatedAt}
            coverUrl={novel.coverUrl}
            coverSrcSet={novel.coverSrcSet}
            lazy={lazyCover}
            priority={priorityCover}
            sizes={
              isList
                ? "(max-width: 639px) 64px, 76px"
                : "(max-width: 639px) calc(50vw - 34px), (max-width: 1023px) calc(33.333vw - 32px), 270px"
            }
            alt={novel.title}
            className="h-full w-full object-cover transition-transform duration-300 ease-out-quint group-hover/card-link:scale-[1.02]"
            fallbackSize={isList ? 7 : 12}
          />
        </div>

        <div
          className={
            isList
              ? "flex min-w-0 flex-1 flex-col gap-2"
              : "flex flex-1 flex-col gap-2.5 p-3.5 sm:p-4"
          }
        >
          <div className="min-w-0">
            <h3
              className={
                isList
                  ? "line-clamp-2 text-body-lg font-semibold text-foreground"
                  : "line-clamp-2 text-card-title text-foreground"
              }
            >
              {novel.title}
            </h3>
            {novel.author ? (
              <p className="mt-0.5 truncate text-caption text-muted-foreground">{novel.author}</p>
            ) : null}
          </div>

          {novel.description && !isList ? (
            <p className="line-clamp-2 text-caption text-muted-foreground">{novel.description}</p>
          ) : null}

          <div className="mt-auto flex flex-col gap-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <LangPair source={novel.sourceLang} target={novel.targetLang} />
              {isAdmin ? (
                <Badge variant={state === "live" ? "successOutline" : "mutedOutline"}>
                  {t(publicationStateKey(state))}
                </Badge>
              ) : null}
            </div>

            {isAdmin ? (
              <div className="flex min-w-0 items-center gap-2">
                <Progress
                  value={percent}
                  aria-label={t("translationProgressLabel", { title: novel.title })}
                  className="h-1 min-w-0 flex-1 gap-0"
                />
                <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
                  {novel.translatedCount}/{novel.chapterCount} · {percent}%
                </span>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
                <BookOpen className="size-3.5" aria-hidden="true" />
                {t("chapterCount", { count: novel.chapterCount })}
              </p>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
