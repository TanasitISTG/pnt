import { useCallback } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AdminUsersPage } from "@/components/admin/admin-users-page";
import { adminUsersQueryOptions } from "@/lib/admin/query";
import { adminUserListSearchSchema, type AdminUserListSearch } from "@/lib/admin/schemas";
import { hasAdminRole } from "@/lib/auth/roles";

/**
 * Operator screen. The route gate only keeps a curious member from seeing a page whose
 * calls would all fail; the authorization itself lives in the admin server functions,
 * which is where it has to hold.
 */
export const Route = createFileRoute("/_protected/admin")({
  validateSearch: adminUserListSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  beforeLoad: ({ context }) => {
    if (!hasAdminRole(context.user?.role)) throw redirect({ to: "/" });
  },
  loader: async ({ context, location }) => {
    const search = adminUserListSearchSchema.parse(location.search);
    await context.queryClient.ensureQueryData(adminUsersQueryOptions(search));
  },
  head: () => ({
    meta: [
      { title: "Accounts | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminRoutePage,
});

function AdminRoutePage() {
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
