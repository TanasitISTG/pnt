import { createFileRoute, redirect } from "@tanstack/react-router";

import { RelationshipsPage } from "@/components/relationships/relationships-page";
import {
  relationshipMapQueryOptions,
  relationshipMapSearchSchema,
  relationshipNovelQueryOptions,
  relationshipWorkspaceQueryOptions,
} from "@/lib/relationships/query";

export const Route = createFileRoute("/_protected/novels/$novelId/relationships")({
  validateSearch: relationshipMapSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, params }) => {
    const workspace = await context.queryClient.fetchQuery({
      ...relationshipWorkspaceQueryOptions(params.novelId),
      staleTime: 0,
    });
    if (!workspace?.map) {
      throw redirect({ to: "/novels/$novelId", params: { novelId: params.novelId } });
    }
    context.queryClient.setQueryData(
      relationshipNovelQueryOptions(params.novelId).queryKey,
      workspace.novel,
    );
    context.queryClient.setQueryData(
      relationshipMapQueryOptions(params.novelId).queryKey,
      workspace.map,
    );
  },
  component: RelationshipsPage,
});
