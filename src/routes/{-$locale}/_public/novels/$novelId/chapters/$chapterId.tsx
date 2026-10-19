import { createFileRoute, notFound } from "@tanstack/react-router";
import sarabunThaiUrl from "@fontsource/sarabun/files/sarabun-thai-400-normal.woff2?url";

import { ReaderPage } from "@/components/reader/page/reader-page";
import { ReaderPending } from "@/components/reader/page/reader-pending";
import { readerStateQueryOptions } from "@/lib/reader/query";
import {
  chapterQueryOptions,
  readerChapterManifestQueryOptions,
} from "@/lib/content/chapter/chapter.query";
import { headTranslator } from "@/lib/i18n/route-head";
import { readerNovelQueryOptions } from "@/components/reader/page/reader-queries";

export const Route = createFileRoute("/{-$locale}/_public/novels/$novelId/chapters/$chapterId")({
  loader: async ({ params, context }) => {
    const [chapter, chapters, novel] = await Promise.all([
      context.queryClient.ensureQueryData(chapterQueryOptions(params.chapterId, params.novelId)),
      context.queryClient.ensureQueryData(readerChapterManifestQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(readerNovelQueryOptions(params.novelId)),
      context.user
        ? context.queryClient.ensureQueryData(readerStateQueryOptions(params.novelId))
        : Promise.resolve(null),
    ]);
    if (!chapter || !novel || chapter.novelId !== params.novelId) throw notFound();
    if (!chapters.some((item) => item.id === chapter.id)) throw notFound();
    return {
      chapterHead: {
        number: chapter.number,
        title: chapter.title,
        translatedTitle: chapter.translatedTitle,
      },
      novelHead: { title: novel.title, description: novel.description },
    };
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: ReaderPending,
  // The tab title is read in the page's own language, and `head` runs before any provider
  // exists, so it takes the same translator the document does (i18n.md §3).
  head: async ({ loaderData }) => {
    const t = await headTranslator();
    const chapter = loaderData?.chapterHead;
    const novel = loaderData?.novelHead;
    const chapterTitle = chapter
      ? t("reader.chapterLabel", {
          number: Number(chapter.number),
          title: chapter.translatedTitle ?? chapter.title,
        })
      : t("reader.chapterFallback");
    const pageTitle = novel?.title
      ? `${chapterTitle} | ${novel.title} | ${t("meta.siteName")}`
      : `${chapterTitle} | ${t("meta.siteName")}`;
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : t("meta.novelDescription");

    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: description },
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: description },
        { name: "twitter:title", content: pageTitle },
        { name: "twitter:description", content: description },
      ],
      links: [
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: sarabunThaiUrl,
          crossOrigin: "anonymous",
        },
      ],
    };
  },
  remountDeps: ({ params }) => ({ chapterId: params.chapterId }),
  component: ReaderRoutePage,
});

function ReaderRoutePage() {
  const { novelId, chapterId } = Route.useParams();
  const { user } = Route.useRouteContext();

  return <ReaderPage novelId={novelId} chapterId={chapterId} signedIn={Boolean(user)} />;
}
