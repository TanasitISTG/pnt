import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, Outlet, redirect } from "@tanstack/react-router";

import { useNovelPublishState } from "@/components/novels/use-novel-publish-state";
import { StudioShell } from "@/components/studio/studio-shell";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";

/**
 * The owner's workspace, and the gate in front of it. A signed-in reader who does not own
 * this novel is sent to the reading page rather than shown a studio they cannot use, and a
 * novel that does not exist at all is a 404 — the `_protected` layout has already
 * established that there is a session, so ownership is the only question left.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/manage")({
  loader: async ({ context, params }) => {
    const novel = await context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    if (!novel) throw notFound();
    if (!novel.canManage) {
      throw redirect({ to: "/{-$locale}/novels/$novelId", params: { novelId: params.novelId } });
    }
    return { novel };
  },
  remountDeps: ({ params }) => ({ novelId: params.novelId }),
  component: StudioRoute,
});

function StudioRoute() {
  const { novelId } = Route.useParams();
  const { novel: loadedNovel } = Route.useLoaderData();
  // The shell's publish chip has to follow the mutation, and the loader's snapshot never
  // changes: the mutation invalidates the query the loader seeded, so the shell reads that
  // query and keeps the loader only as the first paint and the fallback.
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const novel = novelQuery.data ?? loadedNovel;
  const { publishing, setPublishedAt } = useNovelPublishState(novelId);

  return (
    <StudioShell novel={novel} publishing={publishing} onPublishChange={setPublishedAt}>
      <Outlet />
    </StudioShell>
  );
}
