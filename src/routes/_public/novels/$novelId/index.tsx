import { createFileRoute, notFound } from "@tanstack/react-router";
import { useCallback } from "react";

import { NovelDetailController } from "@/components/novels/novel-detail-controller";
import { NovelPending } from "@/components/novels/novel-detail-pending";
import { chaptersQueryOptions, novelQueryOptions } from "@/components/novels/use-novel-detail-page";
import {
  novelDetailSearchSchema,
  type NovelDetailSearch,
} from "@/components/novels/novel-detail-search";

export const Route = createFileRoute("/_public/novels/$novelId/")({
  validateSearch: novelDetailSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ params, context }) => {
    const novelPromise = context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    if (context.user) {
      const novel = await novelPromise;
      if (!novel) throw notFound();
      return { novel };
    }

    const [novel] = await Promise.all([
      novelPromise,
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
    ]);
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
    const coverBaseUrl = novel?.hasCover ? `/api/covers/${novel.id}` : null;
    const coverUrl = novel?.hasCover ? `${appUrl ?? ""}${coverBaseUrl}` : undefined;
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
      links: coverBaseUrl
        ? [
            {
              rel: "preload",
              as: "image",
              href: `${coverBaseUrl}?w=480${versionParam}`,
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
  const reviewSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const onReviewSearchChange = useCallback(
    (patch: Partial<NovelDetailSearch>) => {
      const includesReport = Object.prototype.hasOwnProperty.call(patch, "reviewReport");
      void navigate({
        search: (previous) => {
          const next = { ...previous, ...patch };
          if (includesReport && patch.reviewReport === undefined) {
            return {
              ...next,
              reviewReport: undefined,
              reviewFilter: "attention",
              reviewPage: 1,
              reviewPageSize: 25,
            };
          }
          if (includesReport && patch.reviewReport !== undefined) {
            return { ...next, section: "quality" };
          }
          return next;
        },
        replace: !includesReport || patch.reviewReport === undefined,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return (
    <NovelDetailController
      novelId={novelId}
      isAdmin={!!user}
      reviewSearch={reviewSearch}
      onReviewSearchChange={onReviewSearchChange}
    />
  );
}
