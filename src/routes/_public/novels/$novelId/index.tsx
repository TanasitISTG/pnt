import { createFileRoute, notFound } from "@tanstack/react-router";

import { NovelPublicPage } from "@/components/novels/detail/novel-public-page";
import { NovelPending } from "@/components/novels/detail/novel-detail-pending";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import { hydrateAdminNovelDetailCore, novelQueryOptions } from "@/lib/content/novel/novel.query";
import { getAdminNovelDetailCore } from "@/lib/content/novel/novel.functions";
import { readerStateQueryOptions } from "@/lib/reader/query";

export const Route = createFileRoute("/_public/novels/$novelId/")({
  loader: async ({ params, context }) => {
    // The owner path is tried first because it is the only one that may see drafts. A
    // signed-in viewer who does not own this novel falls through to the readable path
    // rather than 404ing, which is what a shared catalog requires: the server still decides
    // both, since the core query filters on the viewer's own id.
    if (context.user) {
      const core = await getAdminNovelDetailCore({ data: { novelId: params.novelId } });
      if (core) {
        hydrateAdminNovelDetailCore(context.queryClient, core);
        await context.queryClient.ensureQueryData(readerStateQueryOptions(params.novelId));
        return { novel: core.novel };
      }
    }

    const novelPromise = context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    await Promise.all([
      novelPromise,
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
      // A signed-in reader of someone else's published novel still gets per-account
      // progress and bookmarks; a guest keeps the local-storage reader state.
      context.user
        ? context.queryClient.ensureQueryData(readerStateQueryOptions(params.novelId))
        : Promise.resolve(null),
    ]);
    const novel = await novelPromise;
    if (!novel) throw notFound();
    return { novel };
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: NovelPending,
  head: ({ loaderData }) => {
    const novel = loaderData?.novel;
    const title = novel
      ? `${novel.title} | Pnt - Personal Novel Translator`
      : "Novel Detail | Pnt - Personal Novel Translator";
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : "Read translated web novel chapters.";
    const appUrl = import.meta.env.VITE_APP_URL;
    const proxiedCoverUrl = novel?.hasCover ? `/api/covers/${novel.id}` : null;
    // Live novels carry a CDN URL; drafts fall back to the proxied route so the
    // social preview never exposes an unpublished cover key.
    const coverUrl =
      novel?.coverUrl ?? (proxiedCoverUrl ? `${appUrl ?? ""}${proxiedCoverUrl}` : undefined);
    const version = novel?.updatedAt ? new Date(novel.updatedAt).getTime() : null;
    const versionParam = version ? `&v=${version}` : "";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(coverUrl ? [{ property: "og:image", content: coverUrl }] : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(coverUrl ? [{ name: "twitter:image", content: coverUrl }] : []),
      ],
      links: novel?.coverUrl
        ? [
            {
              rel: "preload",
              as: "image",
              href: novel.coverUrl,
              imageSrcSet: novel.coverSrcSet ?? undefined,
              fetchPriority: "high",
            },
          ]
        : proxiedCoverUrl
          ? [
              {
                rel: "preload",
                as: "image",
                href: `${proxiedCoverUrl}?w=480${versionParam}`,
                fetchPriority: "high",
              },
            ]
          : [],
    };
  },
  remountDeps: ({ params }) => ({ novelId: params.novelId }),
  component: NovelDetailRoute,
});

function NovelDetailRoute() {
  const { novelId } = Route.useParams();
  const { user } = Route.useRouteContext();

  return <NovelPublicPage novelId={novelId} signedIn={Boolean(user)} />;
}
