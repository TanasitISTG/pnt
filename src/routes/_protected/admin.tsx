import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { hasAdminRole } from "@/lib/auth/roles";

/**
 * Operator layout. The route gate only keeps a curious member from seeing pages whose
 * calls would all fail; the authorization itself lives in the admin server functions,
 * which is where it has to hold.
 */
export const Route = createFileRoute("/_protected/admin")({
  beforeLoad: ({ context }) => {
    if (!hasAdminRole(context.user?.role)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Admin | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLayout,
});

const TAB_CLASS =
  "inline-flex min-h-9 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground";

function AdminLayout() {
  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Operator sections"
        className="inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        <Link
          to="/admin"
          activeOptions={{ exact: true }}
          className={TAB_CLASS}
          activeProps={{ className: "bg-background text-foreground shadow-sm" }}
        >
          Accounts
        </Link>
        <Link
          to="/admin/activity"
          className={TAB_CLASS}
          activeProps={{ className: "bg-background text-foreground shadow-sm" }}
        >
          Activity
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
