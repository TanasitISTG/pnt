import { createFileRoute, notFound } from "@tanstack/react-router";
import sarabunThaiUrl from "@fontsource/sarabun/files/sarabun-thai-400-normal.woff2?url";

import { ReaderPage } from "@/components/reader/reader-page";
import { ReaderPending } from "@/components/reader/reader-pending";
import {
  chapterQueryOptions,
  chaptersQueryOptions,
  novelQueryOptions,
} from "@/components/reader/reader-queries";

export const Route = createFileRoute("/_public/novels/$novelId/chapters/$chapterId")({
  loader: async ({ params, context }) => {
    const [chapter, chapters, novel] = await Promise.all([
      context.queryClient.ensureQueryData(chapterQueryOptions(params.chapterId)),
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
    ]);
    if (!chapter || !novel || chapter.novelId !== params.novelId) throw notFound();
    if (!chapters.some((item) => item.id === chapter.id)) throw notFound();
    return { chapter, novel };
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: ReaderPending,
  head: ({ loaderData }) => {
    const chapter = loaderData?.chapter;
    const novel = loaderData?.novel;
    const chapterTitle = chapter
      ? `Ch. ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`
      : "Chapter";
    const novelTitle = novel?.title ?? "Novel";
    const pageTitle = `${chapterTitle} | ${novelTitle} | Pnt - Personal Novel Translator`;
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : "Read translated web novel chapter.";

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

  return <ReaderPage novelId={novelId} chapterId={chapterId} user={user} />;
}
