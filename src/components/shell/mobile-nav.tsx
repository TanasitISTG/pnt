import * as React from "react";
import { Link } from "@tanstack/react-router";
import { LogIn, LogOut, Menu } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { useTranslations } from "use-intl";

import { NAV_MOBILE_LINK_CLASS } from "@/components/shell/nav-styles";
import { useSignOut } from "@/components/shell/use-sign-out";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/user-avatar";
import { useLocalizedParams } from "@/lib/i18n/use-localized-params";
import type { ViewerUser } from "@/lib/profile/types";
import { useViewerAvatar } from "@/lib/profile/use-viewer-avatar";

interface MobileNavProps {
  user: ViewerUser | null;
  isAdmin: boolean;
}

interface MobileNavLink {
  to:
    | "/{-$locale}/catalog"
    | "/library"
    | "/jobs"
    | "/audience"
    | "/settings"
    | "/settings/account"
    | "/admin";
  /** A key in the `shell` catalog, so the drawer names each destination in the reader's language. */
  labelKey: "catalog" | "library" | "activity" | "audience" | "account" | "settings" | "admin";
  /** Only rendered for a signed-in session. */
  requiresSession?: boolean;
  /** Rendered for operators only, after the account destinations. */
  requiresAdmin?: boolean;
}

const MOBILE_LINKS: readonly MobileNavLink[] = [
  { to: "/{-$locale}/catalog", labelKey: "catalog" },
  { to: "/library", labelKey: "library", requiresSession: true },
  { to: "/jobs", labelKey: "activity", requiresSession: true },
  { to: "/audience", labelKey: "audience", requiresSession: true },
  { to: "/settings/account", labelKey: "account", requiresSession: true },
  { to: "/settings", labelKey: "settings", requiresSession: true },
  { to: "/admin", labelKey: "admin", requiresSession: true, requiresAdmin: true },
];

/*
 * A drawer is an occasional surface, so it is allowed real motion — and this is the one
 * place in the shell where the links arrive in sequence rather than all at once. Under
 * reduced motion the list renders settled and the drawer's own CSS transition already
 * collapses to instant (globals.css).
 */
const LIST_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const } },
};

export function MobileNav({ user, isAdmin }: MobileNavProps) {
  const t = useTranslations("shell");
  const localized = useLocalizedParams();
  const [open, setOpen] = React.useState(false);
  const { signingOut, signOut } = useSignOut();
  const avatar = useViewerAvatar();
  const reduceMotion = useReducedMotion();

  const links = MOBILE_LINKS.filter((link) => {
    if (link.requiresAdmin) return Boolean(user) && isAdmin;
    if (link.requiresSession) return Boolean(user);
    return true;
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" />}
        aria-label={t("openMenu")}
      >
        <Menu className="size-4" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="start" className="md:hidden">
        <SheetHeader>
          <SheetTitle>{t("menuLabel")}</SheetTitle>
          {/* The drawer carries the identity the header's account menu used to show: on a
              phone the avatar and the address belong at the top of the list you just
              opened, not behind a second control in the bar. */}
          {user ? (
            <div className="flex min-w-0 items-center gap-2 pt-1">
              <UserAvatar name={user.name || user.email} avatar={avatar} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-caption font-semibold text-foreground">
                  {user.name || user.email}
                </p>
                <p className="truncate text-micro text-muted-foreground">{user.email}</p>
              </div>
            </div>
          ) : null}
        </SheetHeader>
        {/* `overscroll-contain` so a flick that reaches the end of the list stays in the
            panel instead of chaining to the page behind it. */}
        <nav
          aria-label={t("navLabel")}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          <m.ul
            initial={reduceMotion ? false : "hidden"}
            animate="visible"
            variants={LIST_VARIANTS}
            className="m-0 flex list-none flex-col gap-0.5 p-0"
          >
            {links.map((link) => (
              <m.li key={link.to} variants={ITEM_VARIANTS}>
                <Link
                  to={link.to}
                  params={link.to === "/{-$locale}/catalog" ? localized : undefined}
                  preload={false}
                  className={NAV_MOBILE_LINK_CLASS}
                  activeProps={{ className: "bg-surface-inset font-semibold" }}
                  onClick={() => setOpen(false)}
                >
                  {t(link.labelKey)}
                </Link>
              </m.li>
            ))}
          </m.ul>
        </nav>
        <div className="border-t border-border p-3">
          {user ? (
            <Button variant="ghost" className="w-full" onClick={signOut} disabled={signingOut}>
              {signingOut ? <Spinner /> : <LogOut className="size-4" aria-hidden="true" />}
              {signingOut ? t("signingOut") : t("signOut")}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                render={
                  <Link to="/{-$locale}/login" params={localized} onClick={() => setOpen(false)} />
                }
              >
                <LogIn className="size-4" aria-hidden="true" />
                {t("signIn")}
              </Button>
              <Button
                render={
                  <Link to="/{-$locale}/signup" params={localized} onClick={() => setOpen(false)} />
                }
              >
                {t("createAccount")}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
