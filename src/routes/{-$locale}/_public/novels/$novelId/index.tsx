import { createFileRoute, notFound } from "@tanstack/react-router";

import { NovelPublicPage } from "@/components/novels/detail/novel-public-page";
import { NovelPending } from "@/components/novels/detail/novel-detail-pending";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import { hydrateAdminNovelDetailCore, novelQueryOptions } from "@/lib/content/novel/novel.query";
import { getAdminNovelDetailCore } from "@/lib/content/novel/novel.functions";
import { readerStateQueryOptions } from "@/lib/reader/query";

/**
 * A read that reports its own failure instead of throwing it.
 *
 * The route starts three reads at once, and the novel is the one that decides what the page
 * is; the other two have to be allowed to fail without that failure escaping while the novel
 * is still in flight, or it arrives as an unhandled rejection. Settling each one keeps the
 * outcome in hand so the route can decide which failure is the page's and which is the
 * companion refusal of a novel nobody may read.
 */
async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

export const Route = createFileRoute("/{-$locale}/_public/novels/$novelId/")({
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

    // The three reads start together, so a readable novel costs one round trip.
    const chaptersRead = settle(
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
    );
    // A signed-in reader of someone else's published novel still gets per-account
    // progress and bookmarks; a guest keeps the local-storage reader state.
    const readerRead = context.user
      ? settle(context.queryClient.ensureQueryData(readerStateQueryOptions(params.novelId)))
      : null;

    const novelRead = await settle(
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
    );
    // A novel nobody may read has no chapters to list and no progress to restore, and both
    // of those reads refuse in the same breath. That refusal is not a broken page: it is
    // this page being missing, which the novel's own answer decides. Reaching the last two
    // lines with a novel in hand is exactly when a failed chapter or progress read has to
    // keep surfacing as a failure.
    if (!novelRead.ok) throw novelRead.error;
    if (!novelRead.value) throw notFound();

    const chapters = await chaptersRead;
    if (!chapters.ok) throw chapters.error;
    if (readerRead) {
      const reader = await readerRead;
      if (!reader.ok) throw reader.error;
    }
    return { novel: novelRead.value };
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
