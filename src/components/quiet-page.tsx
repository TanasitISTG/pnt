import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface QuietPageProps {
  /** The short code above the title, e.g. `404`. Decorative: the title says it in words. */
  code?: string;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  /** The one action, plus the single escape hatch the surface genuinely needs. */
  children?: ReactNode;
  className?: string;
}

/**
 * The quiet page: centred, single column, one action.
 *
 * It is not `EmptyState`. An empty state explains a region inside a working page and is
 * read after the page's own heading, so it is an `h2` at the card-title step. This is the
 * whole page, so it owns the document's only `h1` and carries the section step - a 404 is a
 * page, not a gap in one.
 *
 * `m-auto` centres the block rather than `items-center` on the parent: a centred flex item
 * taller than its container is clipped above the top of the viewport, where scrolling
 * cannot reach it, while auto margins collapse and let it scroll.
 */
export function QuietPage({ code, icon, title, description, children, className }: QuietPageProps) {
  return (
    <div className={cn("m-auto flex w-full max-w-md flex-col items-center text-center", className)}>
      <div
        className="mb-5 flex size-14 items-center justify-center rounded-full bg-surface-inset text-muted-foreground [&_svg]:size-6"
        aria-hidden="true"
      >
        {icon}
      </div>
      {code ? (
        <p className="text-caption tracking-wide text-muted-foreground tabular-nums">{code}</p>
      ) : null}
      <h1 className="mt-1 text-section text-balance text-foreground">{title}</h1>
      <p className="mt-3 text-body text-pretty text-muted-foreground">{description}</p>
      {children ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>
      ) : null}
    </div>
  );
}
