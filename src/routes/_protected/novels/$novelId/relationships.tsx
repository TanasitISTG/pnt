import { createFileRoute, redirect } from "@tanstack/react-router";

import { RelationshipsPage } from "@/components/relationships/relationships-page";
import {
  relationshipMapQueryOptions,
  relationshipMapSearchSchema,
  relationshipNovelQueryOptions,
} from "@/lib/relationships/query";

export const Route = createFileRoute("/_protected/novels/$novelId/relationships")({
  validateSearch: relationshipMapSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, params }) => {
    const [novel] = await Promise.all([
      context.queryClient.ensureQueryData(relationshipNovelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(relationshipMapQueryOptions(params.novelId)),
    ]);
    if (!novel || novel.sourceLang !== "zh" || novel.targetLang !== "th") {
      throw redirect({ to: "/novels/$novelId", params: { novelId: params.novelId } });
    }
  },
  component: RelationshipsPage,
});
