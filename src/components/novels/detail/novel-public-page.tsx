import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { NovelContextBar } from "@/components/novels/novel-context-bar";
import { useNovelPublishState } from "@/components/novels/use-novel-publish-state";
import { useNovelReadingProgress } from "@/components/novels/use-novel-reading-progress";
import { NovelReviewsSection } from "@/components/reviews/novel-reviews-section";
import { NovelChapterList } from "@/components/novels/detail/novel-chapter-list";
import { NovelHeader } from "@/components/novels/detail/novel-header";
import { readerChapterManifestQueryOptions } from "@/lib/content/chapter/chapter.query";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";
import { publishState } from "@/lib/content/publish/publish";
import { useReaderState } from "@/lib/reader/use-reader-state";

const EMPTY_CHAPTERS: never[] = [];

export interface NovelPublicPageProps {
  novelId: string;
  /** Any session at all: it decides whether progress is an account's or this browser's. */
  signedIn: boolean;
}

/**
 * The novel as everyone reads it. This page used to be the owner's studio as well, so a
 * reader had to scroll past a management toolbar and a three-tab strip to reach the text.
 * Now it is one reading surface for every viewer, and the owner's tools live at `/manage/*`
 * behind the trail's own entry point.
 */
export function NovelPublicPage({ novelId, signedIn }: NovelPublicPageProps) {
  const t = useTranslations("novel");
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const chaptersQuery = useQuery(readerChapterManifestQueryOptions(novelId));
  const readerState = useReaderState(novelId, signedIn);
  const { publishing, setPublishedAt } = useNovelPublishState(novelId);

  const novel = novelQuery.data;
  const canManage = novel?.canManage ?? false;
  const chapters = chaptersQuery.data ?? EMPTY_CHAPTERS;
  const reading = useNovelReadingProgress(chapters, readerState);
  const chaptersPending = chaptersQuery.isPending || !readerState.ready;

  if (novelQuery.isError || chaptersQuery.isError) {
    return (
      <QueryErrorState
        title={t("loadFailed")}
        error={novelQuery.error || chaptersQuery.error}
        onRetry={() => {
          novelQuery.refetch();
          chaptersQuery.refetch();
        }}
        className="my-12 min-h-[40vh]"
      />
    );
  }

  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-card-title font-semibold text-foreground">{t("notFoundTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("notFoundDescription")}</p>
        <Button className="mt-4" render={<Link to="/{-$locale}/catalog" />}>
          {t("browseCatalog")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <NovelContextBar
        novelId={novelId}
        title={novel.title}
        sourceLang={novel.sourceLang}
        targetLang={novel.targetLang}
        canManage={canManage}
        publishedAt={novel.publishedAt}
        publishing={publishing}
        onPublishChange={canManage ? setPublishedAt : undefined}
        origin={canManage ? "library" : "catalog"}
        current="novel"
      />

      <NovelHeader
        novel={novel}
        novelId={novelId}
        signedIn={signedIn}
        isOwner={canManage}
        canReport={signedIn && !canManage}
        chapters={chapters}
        chaptersPending={chaptersPending}
        readingActionsPending={chaptersPending}
        lastReadChapter={reading.lastReadChapter}
        firstChapter={reading.firstChapter}
        readingProgress={reading}
      />

      <NovelChapterList
        novelId={novelId}
        chapters={chapters}
        readChapterIdSet={reading.readChapterIdSet}
        currentChapterId={reading.lastReadChapter?.id ?? null}
        loading={chaptersPending}
        canManage={canManage}
      />

      <NovelReviewsSection
        novelId={novelId}
        signedIn={signedIn}
        canManage={canManage}
        isLive={publishState(novel.publishedAt) === "live"}
      />
    </div>
  );
}
