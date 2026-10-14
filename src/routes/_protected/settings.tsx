import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SettingsNav } from "@/components/settings/settings-nav";
import { hasAdminRole } from "@/lib/auth/roles";

/**
 * The settings hub.
 *
 * It is a layout, not a page: every section is a destination with its own URL, so a
 * reader can bookmark the provider form or send themselves the security screen. The
 * heading and the section nav are rendered once here rather than repeated per section.
 */
export const Route = createFileRoute("/_protected/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { user } = Route.useRouteContext();

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h1 className="text-section font-semibold text-foreground">Settings</h1>
        <p className="mt-1 max-w-2xl text-body-lg text-muted-foreground">
          Your account, your translation provider, how the app looks, and what it holds. Each
          section saves on its own.
        </p>
      </div>
      <SettingsNav isAdmin={hasAdminRole(user?.role)} />
      <Outlet />
    </div>
  );
}
