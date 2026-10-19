import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsPage } from "@/components/studio/analytics/analytics-page";
import { DEFAULT_AUDIENCE_RANGE } from "@/lib/analytics/aggregate";
import { audienceQueryOptions } from "@/lib/analytics/query";
import { novelQueryOptions } from "@/lib/content/novel/novel.query";

/**
 * The audience report is prefetched with the same read the page performs, so the loader and
 * the component never ask the database for the same numbers twice: the first paint is the
 * report, not a spinner over it.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/manage/analytics")({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(
        audienceQueryOptions(params.novelId, DEFAULT_AUDIENCE_RANGE),
      ),
    ]);
  },
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  const { novelId } = Route.useParams();
  return <AnalyticsPage novelId={novelId} />;
}
