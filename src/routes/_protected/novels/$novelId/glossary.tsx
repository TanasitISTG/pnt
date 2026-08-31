import { createFileRoute } from "@tanstack/react-router";

import { GlossaryPage } from "@/components/glossary/glossary-page";
import {
  glossaryNovelQueryOptions,
  glossaryStatsQueryOptions,
  glossaryTermsQueryOptions,
} from "@/lib/glossary/query";
import { glossaryListSearchSchema } from "@/lib/glossary/schemas";

export const Route = createFileRoute("/_protected/novels/$novelId/glossary")({
  validateSearch: glossaryListSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, location, params }) => {
    const search = glossaryListSearchSchema.parse(location.search);
    await Promise.all([
      context.queryClient.ensureQueryData(glossaryNovelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(glossaryTermsQueryOptions(params.novelId, search)),
    ]);
  },
  component: GlossaryPage,
});
