import { Link } from "@tanstack/react-router";
import { ChevronRight, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { PublishMenu } from "@/components/publish-menu";
import { Button } from "@/components/ui/button";
import { LangPair } from "@/components/ui/lang-pair";
import { cn } from "@/lib/utils";

export interface NovelTrailProps {
  novelId: string;
  title: string;
  /** Where the reader came from; the owner's shelf is the library, everyone else's the catalog. */
  origin?: "catalog" | "library";
  /** Which end of the trail is the current page. */
  current?: "novel" | "manage" | "chapter";
  /** The chapter crumb, only on the reader. */
  chapterLabel?: string;
  className?: string;
}

/**
 * The novel's position in the app, as a trail: where you came from, the novel itself, and
 * the language pair it is being translated into. It replaces the bare back-arrow, which
 * told a reader nothing about where "back" was.
 */
export function NovelTrail({
  novelId,
  title,
  origin = "catalog",
  current = "novel",
  chapterLabel,
  className,
}: NovelTrailProps) {
  const originLabel = origin === "library" ? "Your Library" : "Catalog";

  return (
    <nav
      aria-label="Novel"
      className={cn("flex min-w-0 items-center gap-1.5 text-caption", className)}
    >
      <Link
        to={origin === "library" ? "/library" : "/catalog"}
        className="shrink-0 text-muted-foreground no-underline transition-colors duration-micro hover:text-foreground"
      >
        {originLabel}
      </Link>
      <ChevronRight className="size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
      <Link
        to="/novels/$novelId"
        params={{ novelId }}
        aria-current={current === "novel" ? "page" : undefined}
        className={cn(
          "min-w-0 truncate no-underline transition-colors duration-micro",
          current === "novel"
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {title}
      </Link>
      {chapterLabel ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
          <span
            aria-current={current === "chapter" ? "page" : undefined}
            className="min-w-0 truncate font-medium text-foreground"
          >
            {chapterLabel}
          </span>
        </>
      ) : null}
    </nav>
  );
}

export interface NovelContextBarProps {
  novelId: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  /** Whether this viewer owns the novel: publish state and the studio entry point. */
  canManage: boolean;
  publishedAt?: Date | string | null;
  publishing?: boolean;
  onPublishChange?: (publishedAt: Date | null) => void | Promise<void>;
  origin?: NovelTrailProps["origin"];
  /** Which end of the trail is the current page; the studio marks the sub-nav instead. */
  current?: NovelTrailProps["current"];
  /** Hide the studio entry point on the studio itself. */
  showManageLink?: boolean;
  /** The studio sub-nav, rendered under the trail. */
  subNav?: ReactNode;
  className?: string;
}

/**
 * The bar that sits under the header on every novel-scoped surface: trail, title, the
 * language pair, and — for the owner — publish state and the way into the studio. It is
 * the page's first row on the reading page and the studio shell's header, so the two
 * never invent their own back arrow or their own publish control.
 */
export function NovelContextBar({
  novelId,
  title,
  sourceLang,
  targetLang,
  canManage,
  publishedAt,
  publishing = false,
  onPublishChange,
  origin = "catalog",
  current = "novel",
  showManageLink,
  subNav,
  className,
}: NovelContextBarProps) {
  const manageLink = showManageLink ?? canManage;

  return (
    <div className={cn("flex flex-col gap-3 border-b border-border pb-3", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <NovelTrail novelId={novelId} title={title} origin={origin} current={current} />
        <LangPair source={sourceLang} target={targetLang} variant="chip" className="shrink-0" />
        {canManage || manageLink ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {canManage && onPublishChange ? (
              <PublishMenu
                publishedAt={publishedAt}
                pending={publishing}
                onChange={onPublishChange}
                ariaLabel="Novel publishing options"
              />
            ) : null}
            {manageLink ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/novels/$novelId/manage/chapters" params={{ novelId }} />}
              >
                <Settings2 className="size-4" aria-hidden="true" />
                Manage
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {subNav}
    </div>
  );
}
