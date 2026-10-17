import { Link } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { useTranslations } from "use-intl";

import { NotificationBell } from "@/components/notifications/notification-bell";
import { AccountMenu } from "@/components/shell/account-menu";
import { LanguageMenu } from "@/components/shell/language-menu";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NAV_LINK_ACTIVE_CLASS, NAV_LINK_CLASS } from "@/components/shell/nav-styles";
import { ThemeMenu } from "@/components/shell/theme-menu";
import { Button } from "@/components/ui/button";
import { hasAdminRole } from "@/lib/auth/roles";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import type { ViewerUser } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  user: ViewerUser | null;
  /** `reader` renders a compact bar: the chapter reader owns its own toolbar. */
  layout?: "default" | "reader";
}

/**
 * The frame every page sits in: brand, reading destinations, theme, language, and the
 * account or the two doors into one. The reader keeps the same identity but a compact bar,
 * because a chapter page already carries its own toolbar.
 *
 * This shell is reachable from both trees, so its links to reading pages carry the language
 * explicitly: a signed-in reader's own pages have no language in their URLs, and without
 * that the header would quietly send them back to the default language.
 */
export function SiteHeader({ user, layout = "default" }: SiteHeaderProps) {
  const t = useTranslations("shell");
  const localized = useLocalizedParams();
  const reader = layout === "reader";
  const isAdmin = hasAdminRole(user?.role);

  return (
    <header
      className={cn(
        "z-40 border-b border-border bg-background/90 supports-backdrop-filter:backdrop-blur-sm",
        reader ? "relative" : "sticky top-0",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link
          to="/{-$locale}"
          params={localized}
          preload={false}
          className="flex items-center gap-2 no-underline"
        >
          <img src="/logo-64.png" alt="" width={28} height={28} className="size-7 rounded-md" />
          <span className="text-card-title text-foreground">{t("brand")}</span>
        </Link>

        {reader ? null : (
          <nav aria-label={t("navLabel")} className="ml-2 hidden items-center gap-1 md:flex">
            {/* Reading destinations only. Account-level pages and the operator console live
                in the account menu, so the primary navigation never mixes a reader's chores
                with an operator's duties. */}
            <Link
              to="/{-$locale}/catalog"
              params={localized}
              preload={false}
              className={NAV_LINK_CLASS}
              activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
            >
              {t("catalog")}
            </Link>
            {user ? (
              <>
                <Link
                  to="/library"
                  preload={false}
                  className={NAV_LINK_CLASS}
                  activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
                >
                  {t("library")}
                </Link>
                <Link
                  to="/jobs"
                  preload={false}
                  className={NAV_LINK_CLASS}
                  activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
                >
                  {t("activity")}
                </Link>
              </>
            ) : null}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1">
          <LanguageMenu signedIn={user !== null} />
          <ThemeMenu />
          {/* Outside the `md` wrapper below: a reader on a phone needs the bell as much as
              a reader on a laptop, and the account menu is the only thing that folds away. */}
          {user ? <NotificationBell userId={user.id} /> : null}
          {user ? (
            // From `md` up the account menu is the only way to reach the account. Below it
            // the navigation drawer lists the same destinations (Account, Settings,
            // Admin, Sign out), so the header kept two doors to one room.
            <div className="hidden md:flex">
              <AccountMenu user={user} isAdmin={isAdmin} />
            </div>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button variant="ghost" render={<Link to="/{-$locale}/login" params={localized} />}>
                <LogIn className="size-4" aria-hidden="true" />
                {t("signIn")}
              </Button>
              <Button render={<Link to="/{-$locale}/signup" params={localized} />}>
                {t("createAccount")}
              </Button>
            </div>
          )}
          <MobileNav user={user} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}
