import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/cookie-policy")({
  component: CookiePolicyPage,
});

function CookiePolicyPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-display font-bold text-foreground">Cookie Policy</h1>
          <p className="mt-2 text-body text-muted-foreground">
            This policy explains how Pnt uses cookies and local storage to operate the platform.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Essential Cookies</h2>
          <p className="text-body text-foreground">
            We use essential cookies strictly necessary for authenticating admin users. These
            cookies do not require consent.
          </p>
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-semibold text-foreground">better-auth.session_token</div>
            <div className="text-caption text-muted-foreground mt-1">
              Purpose: Authenticates signed-in admin sessions. Duration: Session / 30 days.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            2. Optional Analytics Cookies
          </h2>
          <p className="text-body text-foreground">
            When you grant consent, we use PostHog for product analytics and error tracking to help
            improve service performance and stability.
          </p>
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-semibold text-foreground">ph_* (PostHog)</div>
            <div className="text-caption text-muted-foreground mt-1">
              Purpose: Anonymous usage statistics and exception monitoring. Status: Only active if
              you click "Accept all" on the consent banner.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            3. Browser Local Storage
          </h2>
          <p className="text-body text-foreground">
            We store functional preferences directly in your browser. This data never leaves your
            device:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">pnt-reader-settings</strong>: Font size, typeface,
              and layout preferences.
            </li>
            <li>
              <strong className="text-foreground">pnt-reader-progress</strong>: Reading position
              across chapters.
            </li>
            <li>
              <strong className="text-foreground">pnt-consent-v1</strong>: Your cookie consent
              selection.
            </li>
            <li>
              <strong className="text-foreground">theme</strong>: Dark mode / light mode appearance
              setting.
            </li>
          </ul>
        </section>

        <p className="text-caption text-muted-foreground pt-4 border-t border-border">
          For more details, see our{" "}
          <Link to="/privacy" className="underline underline-offset-4 text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
