import * as React from "react";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { SkipLink } from "@/components/shell/skip-link";
import { TermsNotice } from "@/components/terms-notice";
import { useConsent } from "@/lib/consent";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import type { ImpersonationState, ViewerUser } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

interface AppShellProps {
  user: ViewerUser | null;
  /** Present only while an operator is viewing as the signed-in account. */
  impersonation?: ImpersonationState | null;
  children: React.ReactNode;
  layout?: "default" | "reader";
}

/**
 * The frame every page sits in: skip link, header, standing notices, the one `<main>`
 * landmark, and a footer for everything except the reader. The reader keeps the same
 * header identity but a compact bar, because a chapter page already carries its own
 * toolbar and two sticky headers is one too many.
 */
export function AppShell({
  user,
  impersonation = null,
  children,
  layout = "default",
}: AppShellProps) {
  const { consent, hydrated } = useConsent();
  const reader = layout === "reader";
  // The recorded version is written by the server only, so comparing it against the
  // current one is what turns a version bump into a notice.
  const termsStale = Boolean(user && user.termsVersion !== CURRENT_TERMS_VERSION);

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col bg-background",
        // The consent banner is fixed to the bottom edge and must not cover the last
        // row of content while it is unanswered.
        hydrated && consent === "pending" && "pb-28 md:pb-20",
      )}
    >
      <SkipLink />
      {impersonation ? (
        <ImpersonationBanner
          impersonation={impersonation}
          viewedName={user?.name || user?.email || "another account"}
        />
      ) : null}
      <SiteHeader user={user} layout={layout} />
      <TermsNotice stale={termsStale} />
      <main
        id="main"
        className={cn(
          "mx-auto w-full flex-1",
          reader ? "max-w-[1200px] px-4 py-4 sm:px-6 sm:py-6" : "max-w-[1200px] px-4 py-8 sm:px-6",
        )}
      >
        {children}
      </main>
      {reader ? null : <SiteFooter />}
    </div>
  );
}
