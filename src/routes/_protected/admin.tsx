import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { hasAdminRole } from "@/lib/auth/roles";
import { reportQueueCountsQueryOptions } from "@/lib/reports/query";

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
const ACTIVE_TAB_CLASS = "bg-background text-foreground shadow-sm";

/**
 * The queue tab carries its own backlog count, which is how an operator notices new
 * work without opening the tab. The badge is decorative to assistive technology (the
 * queue itself announces the same number), so the link keeps the plain name "Reports"
 * and a screen reader hears one label rather than a label and a stray digit.
 */
function ReportsTab() {
  const counts = useQuery(reportQueueCountsQueryOptions());
  const openCases = counts.data?.openCases ?? 0;

  return (
    <Link to="/admin/reports" className={TAB_CLASS} activeProps={{ className: ACTIVE_TAB_CLASS }}>
      Reports
      {openCases > 0 ? (
        <Badge variant="muted" size="count" aria-hidden="true" className="ml-1.5">
          {openCases}
        </Badge>
      ) : null}
    </Link>
  );
}

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
          activeProps={{ className: ACTIVE_TAB_CLASS }}
        >
          Accounts
        </Link>
        <ReportsTab />
        <Link
          to="/admin/activity"
          className={TAB_CLASS}
          activeProps={{ className: ACTIVE_TAB_CLASS }}
        >
          Activity
        </Link>
      </nav>
      <Outlet />
    </div>
  );
}
