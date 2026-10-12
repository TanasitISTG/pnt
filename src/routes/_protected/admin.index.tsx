import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { AdminUsersPage } from "@/components/admin/users/admin-users-page";
import { adminUsersQueryOptions } from "@/lib/admin/query";
import { adminUserListSearchSchema, type AdminUserListSearch } from "@/lib/admin/schemas";

export const Route = createFileRoute("/_protected/admin/")({
  validateSearch: adminUserListSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context, location }) => {
    const search = adminUserListSearchSchema.parse(location.search);
    await context.queryClient.ensureQueryData(adminUsersQueryOptions(search));
  },
  component: AdminIndexPage,
});

function AdminIndexPage() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (patch: Partial<AdminUserListSearch>) => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return (
    <AdminUsersPage
      currentUserId={user?.id ?? ""}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
