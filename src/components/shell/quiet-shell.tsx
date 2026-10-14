import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { SkipLink } from "@/components/shell/skip-link";
import { SiteFooter } from "@/components/shell/site-footer";

/**
 * The layout route ids that already place a page inside a frame. A page rendered by one of
 * them must not grow a second header, a second footer or a second `<main>`.
 *
 * `/browse` is absent on purpose: it is a redirect, never a rendered match.
 */
const PAGE_FRAME_ROUTE_IDS = ["/_public", "/_protected"] as const;

/**
 * Whether a layout is still standing around the page being rendered.
 *
 * A route that throws renders its error *in place of itself*, inside the parents that were
 * already matched, so a failure on `/novels/<id>/manage/settings` still renders the signed-in
 * shell. This predicate is how `ErrorPage` knows it owes nothing: the question is not "which
 * page is this" but "did a layout survive above me", which is what the match list answers.
 *
 * A **not-found** is the mirror image - it is resolved at the root, so no layout survives -
 * which is why `NotFoundPage` frames itself unconditionally instead of asking.
 */
export function hasPageFrame(routeIds: readonly string[]): boolean {
  return routeIds.some((id) => PAGE_FRAME_ROUTE_IDS.some((framed) => framed === id));
}

/**
 * The frame for the pages a reader arrives at by accident: a 404, a route that threw, and
 * the auth screens.
 *
 * It is deliberately not `AppShell`. The full shell's navigation describes who is signed
 * in - which these pages cannot: a 404 is reached before, during and after a session, and
 * on the auth screens a header "Sign in" button would point at the page it is already on.
 * What must not vary is the contract, so the frame keeps it: the skip link is still the
 * first focusable element, there is still exactly one `<main>`, the brand is still a link
 * home, and the legal links are still one tab away.
 */
export function QuietShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink />
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center px-4 sm:px-6">
          <Link to="/" preload={false} className="flex items-center gap-2 no-underline">
            <img src="/logo-64.png" alt="" width={28} height={28} className="size-7 rounded-md" />
            <span className="text-card-title text-foreground">Pnt</span>
          </Link>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-4 py-8 sm:px-6"
      >
        {children}
      </main>
      {/* The legal links come from the same footer the rest of the app uses, so the
          quiet pages cannot drift from it. */}
      <SiteFooter />
    </div>
  );
}
