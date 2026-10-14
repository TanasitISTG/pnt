import { Link } from "@tanstack/react-router";
import { LogIn } from "lucide-react";

import { AccountMenu } from "@/components/shell/account-menu";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NAV_LINK_ACTIVE_CLASS, NAV_LINK_CLASS } from "@/components/shell/nav-styles";
import { ThemeMenu } from "@/components/shell/theme-menu";
import { Button } from "@/components/ui/button";
import { hasAdminRole } from "@/lib/auth/roles";
import type { ViewerUser } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  user: ViewerUser | null;
  /** `reader` renders a compact bar: the chapter reader owns its own toolbar. */
  layout?: "default" | "reader";
}

interface PrimaryLink {
  to: "/catalog" | "/library" | "/jobs";
  label: string;
  requiresSession?: boolean;
}

/**
 * Reading destinations only. Account-level pages (profile, settings) and the operator
 * console live in the account menu, so the primary navigation never mixes a reader's
 * chores with an operator's duties.
 */
const PRIMARY_LINKS: readonly PrimaryLink[] = [
  { to: "/catalog", label: "Catalog" },
  { to: "/library", label: "Library", requiresSession: true },
  { to: "/jobs", label: "Activity", requiresSession: true },
];

export function SiteHeader({ user, layout = "default" }: SiteHeaderProps) {
  const reader = layout === "reader";
  const isAdmin = hasAdminRole(user?.role);
  const links = PRIMARY_LINKS.filter((link) => !link.requiresSession || Boolean(user));

  return (
    <header
      className={cn(
        "z-40 border-b border-border bg-background/90 supports-backdrop-filter:backdrop-blur-sm",
        reader ? "relative" : "sticky top-0",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link to="/" preload={false} className="flex items-center gap-2 no-underline">
          <img src="/logo-64.png" alt="" width={28} height={28} className="size-7 rounded-md" />
          <span className="text-card-title text-foreground">Pnt</span>
        </Link>

        {reader ? null : (
          <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                preload={false}
                className={NAV_LINK_CLASS}
                activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1">
          <ThemeMenu />
          {user ? (
            // From `md` up the account menu is the only way to reach the account. Below it
            // the navigation drawer lists the same destinations (Account, Settings,
            // Admin, Sign out), so the header kept two doors to one room.
            <div className="hidden md:flex">
              <AccountMenu user={user} isAdmin={isAdmin} />
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" render={<Link to="/login" />}>
                <LogIn className="size-4" aria-hidden="true" />
                Sign in
              </Button>
              <Button render={<Link to="/signup" />}>Create account</Button>
            </div>
          )}
          <MobileNav user={user} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}
