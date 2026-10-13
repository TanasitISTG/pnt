/**
 * The shell's navigation treatments, in one place so the header, the drawer and the
 * footer cannot drift. The active item is a surface, not a colour shift: a weight change
 * alone is invisible at a glance in a warm monochrome palette.
 */
export const NAV_LINK_CLASS =
  "inline-flex h-9 items-center rounded-md px-2.5 text-body text-muted-foreground no-underline transition-colors duration-micro hover:bg-surface-inset hover:text-foreground";

export const NAV_LINK_ACTIVE_CLASS = "bg-surface-inset font-semibold text-foreground";

export const NAV_MOBILE_LINK_CLASS =
  "flex min-h-11 items-center rounded-md px-3 text-body-lg text-foreground no-underline transition-colors duration-micro hover:bg-surface-inset";

export const FOOTER_LINK_CLASS =
  "text-caption text-muted-foreground no-underline transition-colors duration-micro hover:text-foreground";
