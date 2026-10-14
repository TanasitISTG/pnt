import { Link } from "@tanstack/react-router";
import { ChevronDown, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";

import { useSignOut } from "@/components/shell/use-sign-out";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "use-intl";
import { useViewerAvatar } from "@/lib/profile/use-viewer-avatar";
import type { ViewerUser } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

interface AccountMenuProps {
  user: ViewerUser;
  isAdmin: boolean;
}

const MENU_LINK_CLASS = "no-underline text-foreground";

/**
 * Everything about the account, in one place: identity, the two account-level
 * destinations, the operator console when the session has the role, and the way out.
 * Reading destinations (catalog, library, jobs) live in the primary navigation instead.
 */
export function AccountMenu({ user, isAdmin }: AccountMenuProps) {
  const t = useTranslations("shell");
  const avatar = useViewerAvatar();
  const { signingOut, signOut } = useSignOut();
  const displayName = user.name || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="iconPill" />}
        disabled={signingOut}
      >
        <UserAvatar name={displayName} avatar={avatar} size="sm" />
        {/* Visually hidden on small screens but never from assistive technology: the
            button is named by the account's display name at every width. */}
        <span className="sr-only max-w-32 truncate lg:not-sr-only lg:inline">{displayName}</span>
        {/* Below `lg` the trigger is the avatar alone: the name is hidden, so a chevron
            pointing at nothing left the header with an uneven, crowded right edge. */}
        <ChevronDown className="hidden size-4 opacity-60 lg:block" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="flex items-center gap-2 py-0.5">
              <UserAvatar name={displayName} avatar={avatar} size="default" />
              <span className="min-w-0">
                <span className={cn("block truncate text-caption font-semibold text-foreground")}>
                  {user.name}
                </span>
                <span className="block truncate text-micro text-muted-foreground">
                  {user.email}
                </span>
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/settings/account" className={MENU_LINK_CLASS} />}>
            <UserRound className="size-4" aria-hidden="true" />
            {t("account")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/settings" className={MENU_LINK_CLASS} />}>
            <Settings className="size-4" aria-hidden="true" />
            {t("settings")}
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem render={<Link to="/admin" className={MENU_LINK_CLASS} />}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {t("admin")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} disabled={signingOut}>
          {signingOut ? <Spinner /> : <LogOut className="size-4" aria-hidden="true" />}
          {signingOut ? t("signingOut") : t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
