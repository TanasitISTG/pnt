import { createFileRoute } from "@tanstack/react-router";

import { JobsPage } from "@/components/jobs/jobs-page";
import { hydrateJobDashboardQueries } from "@/lib/job-dashboard/query";
import { jobHistorySearchSchema } from "@/lib/job-dashboard/contracts";
import { getJobDashboard } from "@/lib/job-dashboard/functions";

export const Route = createFileRoute("/_protected/jobs")({
  validateSearch: jobHistorySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, location }) => {
    const search = jobHistorySearchSchema.parse(location.search);
    const dashboard = await getJobDashboard({ data: search });
    hydrateJobDashboardQueries(context.queryClient, search, dashboard);
  },
  head: () => ({
    meta: [{ title: "Job activity | Pnt - Personal Novel Translator" }],
  }),
  component: JobsPage,
});
