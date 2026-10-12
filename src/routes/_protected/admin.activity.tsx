import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { AdminActivityPage } from "@/components/admin/activity/admin-activity-page";
import { adminActivityQueryOptions } from "@/lib/admin/query";
import { adminActivitySearchSchema, type AdminActivitySearch } from "@/lib/admin/schemas";

export const Route = createFileRoute("/_protected/admin/activity")({
  validateSearch: adminActivitySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, location }) => {
    const search = adminActivitySearchSchema.parse(location.search);
    await context.queryClient.ensureQueryData(adminActivityQueryOptions(search));
  },
  component: AdminActivityRoutePage,
});

function AdminActivityRoutePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (patch: Partial<AdminActivitySearch>) => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return <AdminActivityPage search={search} onSearchChange={onSearchChange} />;
}
