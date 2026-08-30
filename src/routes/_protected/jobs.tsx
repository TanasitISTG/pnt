import { createFileRoute } from "@tanstack/react-router";

import { JobsPage } from "@/components/jobs/jobs-page";
import { hydrateJobDashboardQueries } from "@/lib/job-dashboard-query";
import { getJobDashboard } from "@/lib/job-observability.functions";

export const Route = createFileRoute("/_protected/jobs")({
  loader: async ({ context }) => {
    const dashboard = await getJobDashboard();
    hydrateJobDashboardQueries(context.queryClient, dashboard);
  },
  component: JobsPage,
});
