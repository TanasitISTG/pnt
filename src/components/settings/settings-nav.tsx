import { Link } from "@tanstack/react-router";

import { NAV_LINK_ACTIVE_CLASS, NAV_LINK_CLASS } from "@/components/shell/nav-styles";
import { cn } from "@/lib/utils";

interface SettingsLink {
  to:
    | "/settings/account"
    | "/settings/provider"
    | "/settings/appearance"
    | "/settings/security"
    | "/settings/data";
  label: string;
  /** Operators only: the backup tools move metered data out of the production database. */
  requiresAdmin?: boolean;
}

/**
 * Ordered by how often a section is opened. Account is what a reader arrives for, the
 * provider is the one setting that blocks translation, and Security — which ends in the
 * only action here that cannot be undone — sits near the end.
 */
const SETTINGS_LINKS: readonly SettingsLink[] = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/provider", label: "Provider" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/security", label: "Security" },
  { to: "/settings/data", label: "Data", requiresAdmin: true },
];

/**
 * The settings sections as one sub-navigation, using the same treatment as the site
 * header, the studio and the operator console. Settings and Profile used to be two pages
 * pointing at each other with nine stacked cards between them; one hub with named
 * sections is what replaced that.
 */
export function SettingsNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const links = SETTINGS_LINKS.filter((link) => !link.requiresAdmin || isAdmin);

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className={cn(NAV_LINK_CLASS, "shrink-0")}
          activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
