import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { ReportsPage } from "@/components/admin/reports/reports-page";
import { reportCaseQueueQueryOptions, reportHistoryQueryOptions } from "@/lib/reports/query";
import { reportQueueSearchSchema, type ReportQueueSearch } from "@/lib/reports/schemas";

export const Route = createFileRoute("/_protected/admin/reports")({
  validateSearch: reportQueueSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, location }) => {
    const search = reportQueueSearchSchema.parse(location.search);
    // Only the tab being opened is prefetched; the other stays untouched until asked
    // for. The two branches are written out rather than selected by a ternary so the
    // prefetch and the page's own query agree on the cached shape.
    if (search.tab === "history") {
      await context.queryClient.ensureQueryData(reportHistoryQueryOptions(search));
      return;
    }
    await context.queryClient.ensureQueryData(reportCaseQueueQueryOptions(search));
  },
  head: () => ({
    meta: [
      { title: "Reports | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminReportsRoutePage,
});

function AdminReportsRoutePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (patch: Partial<ReportQueueSearch>) => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return <ReportsPage search={search} onSearchChange={onSearchChange} />;
}
