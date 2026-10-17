import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { NAV_LINK_ACTIVE_CLASS, NAV_LINK_CLASS } from "@/components/shell/nav-styles";
import { cn } from "@/lib/utils";

interface StudioLink {
  to:
    | "/novels/$novelId/manage/chapters"
    | "/novels/$novelId/manage/add"
    | "/novels/$novelId/manage/quality"
    | "/novels/$novelId/manage/glossary"
    | "/novels/$novelId/manage/relationships"
    | "/novels/$novelId/manage/settings";
  labelKey:
    | "sectionChapters"
    | "sectionAdd"
    | "sectionQuality"
    | "sectionGlossary"
    | "sectionRelationships"
    | "sectionSettings";
}

/** Ordered by how often an owner visits each, which is why Settings sits last. */
const STUDIO_LINKS: readonly StudioLink[] = [
  { to: "/novels/$novelId/manage/chapters", labelKey: "sectionChapters" },
  { to: "/novels/$novelId/manage/add", labelKey: "sectionAdd" },
  { to: "/novels/$novelId/manage/quality", labelKey: "sectionQuality" },
  { to: "/novels/$novelId/manage/glossary", labelKey: "sectionGlossary" },
  { to: "/novels/$novelId/manage/relationships", labelKey: "sectionRelationships" },
  { to: "/novels/$novelId/manage/settings", labelKey: "sectionSettings" },
];

export interface StudioNavProps {
  novelId: string;
  /** The relationship map only exists for a language pair the analyzer supports. */
  showRelationships: boolean;
}

/**
 * The studio's sections as one sub-navigation under the context bar. It scrolls
 * horizontally at 320px rather than collapsing into a select, because moving between
 * Chapters and Add chapters is the most common thing an owner does here.
 */
export function StudioNav({ novelId, showRelationships }: StudioNavProps) {
  const t = useTranslations("studio");
  const links = STUDIO_LINKS.filter(
    (link) => showRelationships || link.to !== "/novels/$novelId/manage/relationships",
  );

  return (
    <nav
      aria-label={t("navLabel")}
      className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 [scrollbar-width:none]"
    >
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          params={{ novelId }}
          className={cn(NAV_LINK_CLASS, "shrink-0")}
          activeProps={{ className: NAV_LINK_ACTIVE_CLASS, "aria-current": "page" }}
        >
          {t(link.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
